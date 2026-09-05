import type {
  ActionSpec,
  AgentArmyDashboardVM,
  ApprovalCenterVM,
  ApprovalDetailVM,
  AttentionAction,
  AttentionHomeVM,
  AttentionItem,
  // R20 R19-27（工作项跨 run 审计时间线）：GET /api/workitems/:id/audit 返回的审计事实行。
  AuditActor,
  AuditLogFact,
  ConversationMessageVM,
  ConversationReactionKey,
  CostDashboardVM,
  CalendarPageVM,
  DeliverableChange,
  DeliverableCheck,
  DrivePageVM,
  EvidenceBubble,
  EvidenceRef,
  GithubActivityVM,
  ProposalConflict,
  ProposalDetailVM,
  MeetingPageVM,
  NotificationPageVM,
  ProjectHealthPageVM,
  ProjectHomePageVM,
  ProjectListVM,
  ProjectMilestoneVM,
  ProjectTimelinePageVM,
  TimelineWorkItemVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  TaskPlanVM,
  GoldPathSurfaceVM,
  WorkItemAgentTeamVM,
  // R23 P4（R20 P2A 端点上界面）：工作项评论流的行契约。
  WorkItemComment,
  WorkItemDetailVM,
  // R14 批 MEM（记忆可见可治理）：/settings/memory 两 tab 的管理面 VM。
  UserMemoryManagementPageVM,
  UserMemoryManagementItemVM,
  TeamSkillManagementPageVM,
  TeamSkillManagementItemVM
} from "@workhub/contracts";
// R23 P4：留言输入框的长度上限直接用契约常量，避免前后端各写一个数字后悄悄漂移。
import { WORK_ITEM_COMMENT_MAX_CHARS } from "@workhub/contracts";

import { personAvatarTileHtml } from "../avatar/avatar-tile.js";
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
  formatLocalDate,
  formatLocalTimestamp,
  notificationTypeLabel,
  previewKindLabel,
  proposalStatusLabel,
  taskPlanItemRoleLabel,
  taskPlanItemStatusLabel,
  taskPlanStatusLabel,
  uiCount,
  uiFormatCny,
  uiFormatCount,
  uiHumanize,
  uiT,
  workItemStatusLabel
} from "../i18n.js";
import { approvalQueuePageInfoText, goldPathT, normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage } from "./render.js";

import { goldPathCopyT } from "./locales.js";
import { auditActionLabels, auditEntityTypeLabels, routeCopy, type RouteCopyKey } from "./route-components-copy.js";

// "agents"/"skills"/"projects"/"project-home"/"memory" 是 live-only 路由（不在 gold-path 静态 surface 渲染里），故单独并入而非走 Extract。
export type WebRouteComponentKey = Extract<GoldPathRenderedPage["key"], "home" | "intake" | "approvals" | "workitem" | "proposal" | "conversation" | "drive" | "meetings" | "notifications" | "calendar" | "health" | "replay" | "cost" | "knowledge" | "search" | "settings"> | "agents" | "skills" | "projects" | "project-home" | "project-timeline" | "memory";

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
  // R10-P1-4：冲突接口加载失败 ≠ 零冲突——标志位透传到提议页渲显式 partial 提示。
  proposal_conflicts_check_failed?: boolean;
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
  ".wh-r4-route-kicker{color:var(--wh-product-blue,#4F46E5);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}",
  ".wh-r4-route-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:14px;align-items:start}",
  ".wh-r4-route-stack{display:grid;gap:12px;min-width:0}",
  ".wh-r4-route-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;border-top:1px solid var(--wh-product-line,#E6E7EB);padding-top:12px}",
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
  ".wh-r4-route-row[data-r4-drive-item-selected=\"true\"]{border-radius:12px;box-shadow:inset 3px 0 0 var(--wh-product-blue,#4F46E5);background:var(--wh-product-blue-tint,#F5F5FE)}",
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
  ".wh-r4-route-card[data-intake-option-selected=true]{border-color:var(--wh-product-blue,#4F46E5);box-shadow:0 0 0 1px rgba(53,92,255,.22),0 12px 28px rgba(37,51,79,.08)}",
  ".wh-r4-route-table{display:grid;gap:8px;min-width:0}",
  ".wh-r4-route-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-start}",
  ".wh-r4-route-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
  ".wh-r4-route .wh-btn,.wh-r4-route .wh-pill{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}",
  ".wh-drive-upload-control{display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center;max-width:100%}.wh-drive-upload-label{position:relative;cursor:pointer}.wh-drive-upload-input{position:absolute;inline-size:1px;block-size:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",
  ".wh-r5-drive-preview-panel{grid-column:1/-1}.wh-r5-drive-preview-body{margin:0;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:12px;background:rgba(247,250,254,.82);color:var(--wh-product-ink,#172033);font:13px/1.55 \"SFMono-Regular\",\"Cascadia Mono\",Consolas,monospace}",
  // R14（网盘回滚两端对齐）：版本行里的「找回这个版本」是一个 <details> 二次确认盒——折叠态只露出
  // summary 按钮（.wh-r4-route details 通用规则已隐藏其余子节点），展开后才看到说明文字与真提交按钮。
  ".wh-r4-drive-version-restore{margin-top:2px}.wh-r4-drive-version-restore summary{cursor:pointer;list-style:none;width:max-content}.wh-r4-drive-version-restore summary::-webkit-details-marker{display:none}.wh-r4-drive-version-restore[open] summary{margin-bottom:6px}.wh-r4-drive-version-restore .wh-r4-route-actions p{flex:1 1 100%;font-size:12.5px}",
  ".wh-r4-route details:not([open])>*:not(summary){display:none}",
  ".wh-r4-intake-free-text{width:100%;min-height:92px;resize:vertical;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:10px 12px;font:inherit;line-height:1.45;color:var(--wh-product-ink,#172033);background:rgba(255,255,255,.92);overflow-wrap:anywhere}",
  ".wh-r4-knowledge-search{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 4px;min-width:0;max-width:100%}.wh-r4-knowledge-search input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:rgba(255,255,255,.92)}.wh-r4-knowledge-search .wh-btn{flex:0 0 auto}",
  // R14 批 SEARCH（web-search-page）：顶栏搜索页表单，照 .wh-r4-knowledge-search 同款输入+按钮布局；
  // 结果行复用 .wh-r4-route-row 骨架，链接行加 .wh-r14-search-result-link（照 .wh-r4-drive-item-link
  // 整行可点、strong 变色悬停下划线的模式）。会话结果不可点（web 无聊天页），不套此类。
  ".wh-r14-search-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 4px;min-width:0;max-width:100%}.wh-r14-search-form input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:rgba(255,255,255,.92)}.wh-r14-search-form .wh-btn{flex:0 0 auto}",
  ".wh-r14-search-result-link{display:block;color:inherit;text-decoration:none}.wh-r14-search-result-link strong{color:var(--wh-product-accent,#2f6df0)}.wh-r14-search-result-link:hover strong,.wh-r14-search-result-link:focus-visible strong{text-decoration:underline}",
  ".wh-r4-project-create{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0;max-width:100%}.wh-r4-project-create input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:rgba(255,255,255,.92)}.wh-r4-project-create .wh-btn{flex:0 0 auto}",
  ".wh-r5-notif-mute summary{cursor:pointer;font-weight:800;font-size:14px;color:var(--wh-product-ink,#172033)}.wh-r5-notif-mute-list{display:grid;gap:8px;margin-top:8px;min-width:0}.wh-r5-notif-mute-row{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.4;color:var(--wh-product-secondary,#5B616E);min-width:0;overflow-wrap:anywhere}.wh-r5-notif-mute-row input{margin-top:2px;flex:0 0 auto}.wh-r5-notif-mute-row span{min-width:0}.wh-r5-notif-mute-status{margin:8px 0 0;font-size:12px}",
  ".wh-r4-route-count{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.75);border-radius:12px;background:rgba(255,255,255,.8);padding:8px 10px;color:var(--wh-product-ink,#172033);font-weight:900;line-height:1}",
  ".wh-r4-route-timeline{display:grid;gap:8px}",
  // UX-M12（规格 §3.6 移动端）：KPI 行窄屏保持 2×2，不塌单列。
  "[data-r9-agent-dashboard-kpis=true]{grid-template-columns:repeat(4,minmax(0,1fr))}",
  "@media (max-width:860px){[data-r9-agent-dashboard-kpis=true]{grid-template-columns:repeat(2,minmax(0,1fr))}}",
  // R3 移动端：军团子任务行的 pill 群在窄屏收紧字号+间距；可点的 pill（链接）加下划线与按钮描边区分。
  "@media (max-width:640px){[data-r9-agent-team-item] .wh-r4-route-meta{gap:4px}[data-r9-agent-team-item] span.wh-pill{font-size:11px;padding:4px 7px}[data-r9-agent-team-item] a.wh-pill{min-height:32px;display:inline-flex;align-items:center}}",
  "[data-r9-agent-team-item] a.wh-pill{text-decoration:underline;border:1px solid var(--wh-product-line,#E6E7EB)}",
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
  ".wh-r4-home-banner{display:flex;align-items:center;gap:10px;padding:11px 14px;border:1px solid #F1DC9C;border-radius:12px;background:#FEFBF0;color:#8A7330;font-size:13px;font-weight:700;flex-wrap:wrap;line-height:1.5}.wh-r4-home-banner b{color:#1A1D26;font-weight:900}.wh-r4-home-banner-cat{width:18px;height:18px;border-radius:50% 50% 45% 45%;background:#1A1D26;position:relative;flex:0 0 auto}.wh-r4-home-banner-cat::before,.wh-r4-home-banner-cat::after{content:\"\";position:absolute;top:6px;width:4px;height:4px;border-radius:999px;background:#F4D35E}.wh-r4-home-banner-cat::before{left:4px}.wh-r4-home-banner-cat::after{right:4px}.wh-r4-home-kao{color:var(--wh-product-blue,#4F46E5)}",
  ".wh-r4-home-chips{display:flex;gap:10px;flex-wrap:wrap}.wh-r4-home-chip{display:flex;align-items:center;gap:8px;padding:11px 14px;border:1px solid rgba(255,255,255,.78);border-radius:12px;background:rgba(255,255,255,.8);font-size:12px;font-weight:700;color:var(--wh-product-secondary,#5B616E);min-width:118px}.wh-r4-home-chip b{font-size:22px;font-weight:900;color:var(--wh-product-ink,#1A1D26);line-height:1}.wh-r4-home-chip--accent{border-color:var(--wh-product-blue-pale,#D9DBF5);background:var(--wh-product-blue-tint,#F5F5FE);color:var(--wh-product-blue,#4F46E5)}.wh-r4-home-chip--accent b{color:var(--wh-product-blue,#4F46E5)}.wh-r4-home-chip--ok b{color:var(--wh-product-green,#15A05A)}",
  ".wh-r4-decision{position:relative;border-color:var(--wh-product-blue-pale,#D9DBF5);overflow:hidden}.wh-r4-decision .wh-r4-decision-top{position:absolute;top:0;left:0;right:0;height:3px;background:var(--wh-product-blue,#4F46E5)}.wh-r4-decision h3{font-size:18px}",
  ".wh-r4-prio{font-weight:800}.wh-r4-prio--danger{background:var(--wh-product-red-light,#FCECEC);color:var(--wh-product-red,#E5484D)}.wh-r4-prio--warn{background:var(--wh-product-amber-light,#FCF3E6);color:var(--wh-product-amber,#E0892A)}.wh-r4-prio--muted{background:var(--wh-product-blue-light,#EEF0FE);color:var(--wh-product-blue,#4F46E5)}",
  ".wh-r4-status{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--wh-product-line-alt,#EEF0F3);font-size:12px;font-weight:700;color:var(--wh-product-secondary,#5B616E)}",
  ".wh-r4-run{display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px solid var(--wh-product-line-alt,#EEF0F3);padding-top:10px}.wh-r4-run:first-child{border-top:0;padding-top:0}.wh-r4-run-main{min-width:0}.wh-r4-run-main strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-r4-run-main p{margin:2px 0 0;color:var(--wh-product-muted,#9AA0AC);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-r4-runstate{flex:0 0 auto;font-weight:800}.wh-r4-runstate--accent{background:var(--wh-product-blue-light,#EEF0FE);color:var(--wh-product-blue,#4F46E5)}.wh-r4-runstate--warn{background:var(--wh-product-amber-light,#FCF3E6);color:var(--wh-product-amber,#E0892A)}.wh-r4-runstate--danger{background:var(--wh-product-red-light,#FCECEC);color:var(--wh-product-red,#E5484D)}",
  ".wh-r4-approvals-grid{grid-template-columns:minmax(220px,.85fr) minmax(0,1.3fr) minmax(240px,.85fr)}",
  ".wh-r4-approval-list-item{cursor:pointer}.wh-r4-approval-list-item h3{font-size:14px}.wh-r4-approval-list-item p{font-size:12px}.wh-r4-approval-list-item[data-r4-approval-selected=true]{border-color:var(--wh-product-blue,#4F46E5);box-shadow:inset 3px 0 0 var(--wh-product-blue,#4F46E5)}",
  ".wh-r4-approval-detail h4{margin:4px 0 0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.02em;color:var(--wh-product-secondary,#5B616E)}",
  ".wh-r4-approval-evidence{list-style:none;margin:0;padding:0;display:grid;gap:6px}.wh-r4-approval-evidence li{display:grid;gap:2px;font-size:13px;line-height:1.4}.wh-r4-approval-evidence .wh-subtle{font-size:12px}",
  ".wh-r4-approval-detail-panel[hidden]{display:none}.wh-r4-approval-detail-panel section{display:grid;gap:6px}.wh-r4-approval-field{display:grid;gap:4px}.wh-r4-approval-reason,.wh-r4-approval-comment-input{width:100%;max-width:100%;box-sizing:border-box;min-width:0;resize:vertical;font:inherit;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:6px;overflow-wrap:anywhere}.wh-r4-approval-remember{display:flex;gap:6px;align-items:flex-start;font-size:13px;color:var(--wh-product-secondary,#5B616E)}.wh-r4-approval-comment-form{display:grid;gap:6px}",
  ".wh-r4-approval-detail .wh-r4-route-row{grid-template-columns:1fr}.wh-r4-approval-detail .wh-r4-route-row p,.wh-r4-approval-detail .wh-r4-route-row strong{overflow-wrap:anywhere;white-space:normal}.wh-r4-approval-detail .wh-r4-route-meta{justify-content:flex-start}",
  "@media (max-width:1040px){.wh-r4-approvals-grid{grid-template-columns:1fr}}",
  "@media (max-width:860px){.wh-r4-route-head,.wh-r4-route-grid,.wh-r4-route-row{grid-template-columns:1fr}.wh-r4-route-head{align-items:start}.wh-r4-route-count{width:max-content}.wh-r4-route-actions{align-items:flex-start}}",
  // R14 批 AVATAR（头像与资料入口）：设置页「我的资料」卡的头像位——圆形预览（无头像回退首字母
  // 色块 tile，与工作台聊天/成员条同一套视觉语言，见 apps/desktop-webview 的 avatarTileHtml）+
  // 隐藏 file input（label 触发）+ 移除按钮。裁剪层本身在 apps/web/src/browser.ts 里用内联样式
  // 构造（一次性弹层，不值得为它单开一份共享 CSS）。
  ".wh-avatar-field{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
  ".wh-avatar-preview{position:relative;display:inline-flex;width:48px;height:48px;flex:0 0 auto;border-radius:50%;overflow:hidden;background:var(--wh-product-line,#E6E7EB)}",
  ".wh-avatar-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px}",
  ".wh-avatar-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}",
  ".wh-avatar-upload-label{cursor:pointer}",
  // R14 批 CHAT（web-avatars）：只读小尺寸 tile——铺在审批路由/委派、成本按人/按执行者、项目负责人、
  // 会议上传者、工单负责人这些「VM 已带 user_id 的人物出现点」旁边（packages/ui/src/avatar/
  // avatar-tile.ts 的 personAvatarTileHtml）。复用上面 .wh-avatar-preview/.wh-avatar-fallback/
  // .wh-avatar-img 三个 class，只加尺寸 modifier，不重开一套视觉；margin-right 兼顾内联文本前缀
  // （p/strong 里直接拼接）与 .wh-r4-route-meta 里 flex 兄弟节点两种用法。
  ".wh-avatar-preview--sm{width:18px;height:18px;margin-right:6px;vertical-align:-4px}",
  ".wh-avatar-preview--sm .wh-avatar-fallback{font-size:10px}",
  // R14 批 MEM（记忆可见可治理）：/settings/memory 两 tab（关于我/团队技能）——tab 切换条 + 记忆/
  // 技能列表卡片内的编辑态（整段替换 textarea / K2 段落级 op 行）+ 两段式确认（armed）危险按钮态。
  ".wh-r14-mem-tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--wh-product-line,#E6E7EB);padding-bottom:2px}",
  ".wh-r14-mem-tab{border:0;background:transparent;padding:10px 4px;font-weight:800;color:var(--wh-product-muted,#66728c);cursor:pointer;border-bottom:2px solid transparent}",
  ".wh-r14-mem-tab[aria-selected=true]{color:var(--wh-product-blue,#4F46E5);border-bottom-color:var(--wh-product-blue,#4F46E5)}",
  ".wh-r14-mem-panel[hidden]{display:none}",
  ".wh-r14-mem-textarea{width:100%;min-height:88px;resize:vertical;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:10px 12px;font:inherit;line-height:1.45;color:var(--wh-product-ink,#172033);background:rgba(255,255,255,.92);overflow-wrap:anywhere}",
  ".wh-r14-mem-textarea:disabled{opacity:.6}",
  "[data-r14-mem-delete-btn][data-r9-confirm-armed=true],[data-r14-skill-deactivate-btn][data-r9-confirm-armed=true]{background:#fff1ef;color:#d64545;border-color:#f3c5c0}",
  ".wh-r14-mem-op-row{display:grid;gap:6px;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:10px;margin-top:8px}",
  ".wh-r14-mem-op-row select,.wh-r14-mem-op-row input{font:inherit;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:8px;padding:6px 8px;background:rgba(255,255,255,.92);color:var(--wh-product-ink,#172033)}",
  // R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」字符 tile（✓/✗ 排版符号，非 emoji，
  // 04-feedback-design.md §8 第四层视觉语言）+ 可选备注面板。useful 用既有绿色语汇（同
  // .wh-r9-agent-team-state-dot=succeeded 的 --wh-product-green）；not_useful 故意不用满饱和度红
  // （那是「删除」类危险动作的既有语义），改用中性 amber 弱化——反馈是判断而非警告。
  ".wh-r14-proposal-feedback-tiles{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:2px}",
  ".wh-r14-proposal-feedback-tile{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:999px;padding:7px 12px;font-weight:700;font-size:13px;line-height:1;color:var(--wh-product-secondary,#5B616E);text-decoration:none;background:rgba(255,255,255,.86)}",
  ".wh-r14-proposal-feedback-glyph{font-size:14px;line-height:1}",
  ".wh-r14-proposal-feedback-tile[data-r14-proposal-feedback-tile=\"useful\"].wh-r14-proposal-feedback-tile--on{border-color:var(--wh-product-green,#15A05A);color:var(--wh-product-green,#15A05A);background:rgba(21,160,90,.08)}",
  ".wh-r14-proposal-feedback-tile[data-r14-proposal-feedback-tile=\"not_useful\"].wh-r14-proposal-feedback-tile--on{border-color:var(--wh-product-amber,#d98b16);color:var(--wh-product-amber,#d98b16);background:rgba(217,139,22,.1)}",
  ".wh-r14-proposal-feedback-clear{align-self:center;font-size:12px;color:var(--wh-product-muted,#66728c);text-decoration:underline;cursor:pointer}",
  ".wh-r14-proposal-feedback-clear[hidden]{display:none}",
  ".wh-r14-proposal-feedback-note{display:grid;gap:6px;margin-top:10px}",
  ".wh-r14-proposal-feedback-note-input{width:100%;min-height:64px;resize:vertical;box-sizing:border-box;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;padding:8px 10px;font:inherit;line-height:1.45;color:var(--wh-product-ink,#172033);background:rgba(255,255,255,.92);overflow-wrap:anywhere}",
  ".wh-r14-proposal-feedback-note-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
  ".wh-r14-proposal-feedback-note-actions [data-r14-proposal-feedback-note-save][disabled]{opacity:.5;cursor:not-allowed}",
  // R15 批 web-mirror（web 只读会话镜像）：镜像消息流样式。刻意不用定高 -webkit-line-clamp（CI Linux
  // CJK 溢出门）——所有文本自然换行 + overflow-wrap:anywhere。read-only：没有 composer、没有反应/发送按钮。
  ".wh-mirror{display:grid;gap:14px;min-width:0;max-width:100%}",
  ".wh-mirror-banner{display:grid;gap:4px;border:1px solid var(--wh-product-line,#E6E7EB);border-left:3px solid var(--wh-product-accent,#2f6df0);border-radius:12px;background:rgba(47,109,240,.06);padding:10px 14px;min-width:0}",
  ".wh-mirror-banner strong{font-size:14px;color:var(--wh-product-ink,#172033);overflow-wrap:anywhere}.wh-mirror-banner p{margin:0;font-size:12px;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-mirror-pager{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0}",
  ".wh-mirror-pager .wh-btn{flex:0 0 auto}",
  ".wh-mirror-stream{display:grid;gap:12px;min-width:0}",
  ".wh-mirror-empty{color:var(--wh-product-muted,#66728c);font-size:13px;line-height:1.5;margin:0}",
  ".wh-mirror-msg{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;min-width:0}",
  ".wh-mirror-avatar--cuu{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9px;background:linear-gradient(145deg,#6D8BFF,#4F46E5);color:#fff;font-size:11px;font-weight:850;flex:0 0 auto}",
  ".wh-mirror-bub{display:grid;gap:6px;min-width:0;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:14px;background:rgba(255,255,255,.9);padding:10px 12px}",
  ".wh-mirror-msg--cuu .wh-mirror-bub{background:rgba(79,70,229,.05);border-color:rgba(79,70,229,.18)}",
  ".wh-mirror-msg--target .wh-mirror-bub{box-shadow:0 0 0 2px var(--wh-product-accent,#2f6df0)}",
  ".wh-mirror-who{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0;font-size:13px;font-weight:800;color:var(--wh-product-ink,#172033)}.wh-mirror-who>span{min-width:0;overflow-wrap:anywhere}",
  ".wh-mirror-tm{color:var(--wh-product-muted,#66728c);font-weight:600;font-size:12px}",
  ".wh-mirror-edited,.wh-mirror-pin{display:inline-flex;align-items:center;border-radius:999px;background:var(--wh-product-soft,#f5f8fc);color:var(--wh-product-muted,#66728c);font-size:11px;font-weight:800;padding:2px 8px}",
  ".wh-mirror-text{margin:0;font-size:14px;line-height:1.55;color:var(--wh-product-ink,#172033);overflow-wrap:anywhere;white-space:normal}",
  ".wh-mirror-reply{display:block;border-left:3px solid var(--wh-product-line,#E6E7EB);background:var(--wh-product-soft,#f5f8fc);border-radius:8px;padding:6px 10px;min-width:0}.wh-mirror-reply-who{display:block;font-size:12px;font-weight:800;color:var(--wh-product-secondary,#5B616E)}.wh-mirror-reply-text{display:block;font-size:12px;color:var(--wh-product-muted,#66728c);overflow-wrap:anywhere}.wh-mirror-reply-gone{font-style:italic}",
  ".wh-mirror-reactions{display:flex;gap:6px;flex-wrap:wrap;min-width:0}",
  ".wh-mirror-reaction{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:999px;background:rgba(255,255,255,.86);padding:3px 9px;font-size:12px;font-weight:800;color:var(--wh-product-secondary,#5B616E)}.wh-mirror-reaction-emoji{font-size:13px;line-height:1}",
  ".wh-mirror-filecard{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:10px;background:rgba(255,255,255,.9);padding:8px 11px;font-size:13px;font-weight:750;color:var(--wh-product-ink,#172033);min-width:0;max-width:100%}.wh-mirror-filecard span{min-width:0;overflow-wrap:anywhere}",
  ".wh-mirror-clarify{display:grid;gap:6px;border-left:3px solid var(--wh-product-accent,#2f6df0);padding-left:10px;min-width:0}.wh-mirror-clarify-badge{display:inline-flex;width:max-content;align-items:center;border-radius:999px;background:rgba(47,109,240,.1);color:var(--wh-product-accent,#2f6df0);font-size:11px;font-weight:850;padding:2px 8px}.wh-mirror-clarify-opts{display:flex;gap:6px;flex-wrap:wrap}.wh-mirror-clarify-opt{border:1px solid var(--wh-product-line,#E6E7EB);border-radius:999px;background:var(--wh-product-soft,#f5f8fc);padding:4px 10px;font-size:12px;font-weight:750;color:var(--wh-product-secondary,#5B616E);overflow-wrap:anywhere}",
  ".wh-mirror-sysline{display:flex;gap:10px;align-items:baseline;justify-content:center;flex-wrap:wrap;text-align:center;color:var(--wh-product-muted,#66728c);font-size:12px;line-height:1.5;padding:2px 8px;min-width:0}.wh-mirror-sysline>span:first-child{overflow-wrap:anywhere}.wh-mirror-sysline-tm{color:var(--wh-product-faint,#94a0b8);font-weight:700;flex:0 0 auto}",
  ".wh-mirror-tombstone{color:var(--wh-product-muted,#66728c);font-size:12px;font-style:italic;padding:2px 8px;overflow-wrap:anywhere}",
  ".wh-mirror-note{color:var(--wh-product-muted,#66728c);font-size:12px;line-height:1.5;padding:2px 8px;overflow-wrap:anywhere}"
].join("");

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

// 带占位符的词典条目：`{name}` 按 vars 替换。文案整句留在词典里（两语同形），调用点只提供数值。
function routeTf(locale: WorkHubLocale, key: RouteCopyKey, vars: Record<string, string | number>) {
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    routeCopy[locale][key]
  );
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

// R23 F-04：转交动作（/api/approvals/:id/delegate、/api/escalations/:id/delegate）不能当普通按钮渲——
// 它需要一个「转交给谁」的选人器。此前 web 与两端一样直接把动作剥掉（rank1 的临时办法），于是升级
// 转交端到端零入口。现在改成：动作行里不渲它，改在动作行下面挂一份选人器（renderDelegatePicker），
// 选人 + 确认走 browser.ts 的统一分发。
function isDelegateActionHref(href: string): boolean {
  return /^(?:.*)?\/api\/(?:approvals|escalations)\/[^/]+\/delegate(?:[?#]|$)/u.test(href);
}

// 转交选人器（审批工作台与任意决策卡共用同一份结构）：折叠起来不占地方，展开时才懒加载工作区成员。
// href 省略＝由 browser.ts 按当前选中的审批行推导（审批工作台的动作面板是整页共享的，卡片不固定）。
function renderDelegatePicker(locale: WorkHubLocale, href?: string) {
  const zh = locale === "zh-CN";
  return `<details class="wh-r4-approval-field" data-wh-delegate="true"${href ? ` data-wh-delegate-href="${escapeHtml(safeHref(href))}"` : ""}>
              <summary>${escapeHtml(goldPathCopyT(locale, "handOffToATeammate"))}</summary>
              <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "onLeaveOnRotationOrNot"))}</p>
              <select class="wh-pill" data-wh-delegate-select="true" aria-label="${escapeHtml(goldPathCopyT(locale, "pickATeammate"))}"><option value="">${escapeHtml(goldPathCopyT(locale, "membersLoadOnOpen"))}</option></select>
              <div class="wh-r4-route-actions"><button type="button" class="wh-btn" data-wh-delegate-submit="true">${escapeHtml(goldPathCopyT(locale, "delegate"))}</button></div>
            </details>`;
}

function renderActions(actions: (AttentionAction | ActionSpec)[], locale?: WorkHubLocale) {
  const shown = actions.filter((action) => !isDelegateActionHref(action.href));
  // 卡上带转交动作时，把选人器挂在动作行后面（locale 缺省＝调用方还没接选人器，按旧行为只渲动作）。
  const delegateAction = locale ? actions.find((action) => isDelegateActionHref(action.href)) : undefined;
  const picker = delegateAction && locale ? renderDelegatePicker(locale, delegateAction.href) : "";
  if (shown.length === 0) {
    return picker;
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
      // R12（读屏语义）：POST/DELETE 动作是「按钮」不是「链接」——补 role=button（视觉/分类器不变）。
      const buttonRole = "method" in action && action.method && action.method !== "GET" ? " role=\"button\"" : "";
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(safeHref(action.href))}" data-action-id="${escapeHtml(action.id)}"${buttonRole}${reason}${method}${desktop}${requestJson}${postRunNext}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>${picker}`;
}

function jsonAttr(value: unknown) {
  return escapeHtml(JSON.stringify(value));
}

// M3：决策队列里每条都要能点进去处理,不能是死文本。优先用第一个导航(GET)动作的 href,
// 否则退回工作项/项目详情路由;实在没有目标时才退化为不可点的 div(不造死链)。
function attentionRowHref(item: AttentionItem): string {
  // 普通用户审查（QUEUE-PROMOTE）：队列行统一回首页并把该卡提升为主卡原地处理——
  // 此前取第一个 GET 动作五花八门（冲突行跳回放、审批行跳无动作的工作项页）。
  return `/?focus=${encodeURIComponent(item.id)}`;
}

function renderAttentionRows(items: AttentionItem[], emptyCopy: string, zh: boolean) {
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(emptyCopy)}</p>`;
  }
  // 普通用户审查：芯片报 12、列表只见 4，剩下的去哪了没人说——超出展示上限时明说还有几件。
  // R10-P2-11：补完整队列出路——审批中心承载全部待决策项。
  const overflowNote = items.length > 4
    ? `<p class="wh-subtle" data-r9-attention-overflow="${escapeHtml(String(items.length - 4))}">${escapeHtml(zh
      ? `还有 ${items.length - 4} 件排在后面，处理完上面的会自动顶上来。`
      : `${items.length - 4} more waiting — they surface as you clear the ones above.`)} <a href="/approvals">${escapeHtml(goldPathCopyT(zh, "seeTheFullQueueInApprovals"))}</a></p>`
    : "";
  return items
    .slice(0, 4)
    .map((item) => {
      const href = attentionRowHref(item);
      const inner = `<div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.summary_text)}</p>
      </div>
      ${item.project_name ? `<span class="wh-pill" data-r12-attention-project="true">${escapeHtml(item.project_name)}</span>` : ""}<span class="wh-pill">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span>`;
      return href
        ? `<a class="wh-r4-route-row" href="${escapeHtml(safeHref(href))}" data-r4-route-attention-item="${escapeHtml(item.id)}">${inner}</a>`
        : `<div role="listitem" class="wh-r4-route-row" data-r4-route-attention-item="${escapeHtml(item.id)}">${inner}</div>`;
    })
    .join("") + overflowNote;
}

function approvalRouteLabel(routedToUserId: string | undefined, locale: WorkHubLocale) {
  if (!routedToUserId) {
    return goldPathT(locale, "approvals.unrouted");
  }
  return goldPathCopyT(locale, "routed");
}

function approvalActionLabel(actionPattern: string, locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  const normalized = actionPattern.toLowerCase();
  if (normalized.startsWith("tool.")) {
    return goldPathCopyT(locale, "toolApproval");
  }
  if (normalized.includes("permission") || normalized.includes("policy")) {
    return goldPathCopyT(locale, "permissionApproval");
  }
  if (normalized.includes("budget") || normalized.includes("cost")) {
    return goldPathCopyT(locale, "budgetApproval");
  }
  if (normalized.includes("proposal") || normalized.includes("deliverable") || normalized.includes("document")) {
    return goldPathCopyT(locale, "changeApproval");
  }
  return goldPathCopyT(locale, "approvalRequest");
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
      escalation: "需要负责人介入",
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
      escalation: "Needs owner",
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
    // R5 词表：high 与 attention/工作项侧同词「较高」，同一后端枚举不再两套中文。
    { urgent: "紧急", high: "较高", normal: "常规" },
    { urgent: "Urgent", high: "High", normal: "Normal" }
  );
}

// 通知类型标签(comment.mention / work_item.due_soon / conversation.message …)现由 packages/ui/src/i18n.ts
// 的 notificationTypeLabel 提供(桌面「静音此类」文案共用同一份，见 G4 #22/#35)——本文件只 import 复用。

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
      draft_to_proposal: "草稿转变更申请"
    },
    {
      upload_file: "Upload",
      delete_item: "Delete",
      restore_item: "Restore",
      restore_version: "Restore version",
      rename_item: "Rename",
      comment_to_draft: "Comment → draft",
      draft_to_proposal: "Draft → change request"
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
  const projectCountLabel = projects ? String(projectList.length) : (goldPathCopyT(locale, "projects"));
  const projectRows = projectList.length
    ? projectList.slice(0, 4).map((project) => `<div role="listitem" class="wh-r4-route-row" data-r8-home-project="${escapeHtml(project.id)}" data-r8-home-project-open-items="${escapeHtml(String(project.open_work_item_count))}">
        <div>
          <strong><a class="wh-r4-route-row-title" href="/projects/${escapeHtml(encodeURIComponent(project.id))}">${escapeHtml(project.name)}</a></strong>
          ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}
          <div class="wh-r4-route-meta">
            ${project.owner_user_id ? personAvatarTileHtml({ userId: project.owner_user_id, label: project.owner_nickname }) : ""}<span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.owner")} · ${project.owner_nickname}`)}</span>
            <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.openItems")} ${project.open_work_item_count}`)}</span>
            <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.updated")} ${formatLocalDate(project.updated_at)}`)}</span>
          </div>
        </div>
        <a class="wh-btn" href="/projects/${escapeHtml(encodeURIComponent(project.id))}" data-r8-home-open-project="${escapeHtml(project.id)}">${escapeHtml(routeT(locale, "projects.open"))}</a>
      </div>`).join("") + (projectList.length > 4
      ? `<p class="wh-subtle" data-r9-home-projects-overflow="${escapeHtml(String(projectList.length - 4))}">${escapeHtml(zh
        ? `还有 ${projectList.length - 4} 个项目未显示，` : `${projectList.length - 4} more projects not shown — `)}<a href="/projects">${escapeHtml(goldPathCopyT(locale, "seeAllProjects"))}</a></p>`
      : "")
    : projects === undefined
      // P1-07：加载失败 ≠ 空。projects===undefined 是取数失败——桌内给失败说明（指向上方重试条），
      // 绝不渲「还没有项目」的空态文案把失败谎报成「你没有项目」。
      ? `<p class="wh-subtle" data-r20-home-projects-desk-failed="true">${escapeHtml(goldPathCopyT(locale, "theProjectListDidnTLoad"))}</p>`
      : `<p class="wh-subtle" data-r8-home-projects-empty="true">${escapeHtml(goldPathCopyT(locale, "noProjectsYetCreateOrOpen"))}</p>`;
  const projectDriveHref = topProject ? `/drive?project_id=${encodeURIComponent(topProject.id)}` : "/projects";
  const projectIntakeHref = topProject ? `/intake?project_id=${encodeURIComponent(topProject.id)}` : "/intake";
  const projectDesk = `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent wh-r8-home-project-desk" data-r8-home-project-desk="true" data-r8-home-project-count="${escapeHtml(String(projectList.length))}" data-r8-home-projects-loaded="${escapeHtml(String(Boolean(projects)))}">
      <div class="wh-r4-route-meta">
        <span class="wh-r4-route-kicker">${escapeHtml(goldPathCopyT(locale, "projectsAndDrive"))}</span>
        <span class="wh-pill">${escapeHtml(projects ? (zh ? `项目 ${projectList.length}` : `${projectList.length} projects`) : (goldPathCopyT(locale, "projectListUnavailable")))}</span>
      </div>
      <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "startFromAProjectThenWork"))}</h3>
      <p>${escapeHtml(goldPathCopyT(locale, "eachProjectBehavesLikeARepo"))}</p>
      <div class="wh-r4-route-actions">
        <a class="wh-btn wh-btn-primary" href="/projects" data-r8-home-projects-cta="true">${escapeHtml(goldPathCopyT(locale, "openProjects"))}</a>
        <a class="wh-btn" href="${escapeHtml(safeHref(projectDriveHref))}" data-r8-home-drive-cta="true">${escapeHtml(topProject ? (zh ? `打开「${topProject.name}」网盘` : `Open ${topProject.name} drive`) : (goldPathCopyT(locale, "openDrive")))}</a>
        <a class="wh-btn" href="${escapeHtml(safeHref(projectIntakeHref))}" data-r4-home-intake-cta="true" data-r8-home-new-work-cta="true">${escapeHtml(topProject ? (zh ? `在「${topProject.name}」新建任务` : `New task in ${topProject.name}`) : (goldPathCopyT(locale, "newTask")))}</a>
      </div>
      <div class="wh-r4-route-timeline" role="list">${projectRows}</div>
    </section>`;

  // R8：今日「自进化」——只在确有新增/精修时显示，避免零活动时刷存在感。
  const selfEvolved = (worklog?.skills_promoted_today ?? 0) + (worklog?.skills_refined_today ?? 0);
  const selfEvolveLine = worklog && selfEvolved > 0
    ? `<span class="wh-r4-home-banner-evolve" data-r4-home-self-evolve="true" data-r4-home-skills-promoted="${escapeHtml(String(worklog.skills_promoted_today))}" data-r4-home-skills-refined="${escapeHtml(String(worklog.skills_refined_today))}">${escapeHtml(goldPathCopyT(locale, "alsoLeveledUpSkills"))}${escapeHtml(String(worklog.skills_promoted_today))}${escapeHtml(goldPathCopyT(locale, "refined"))}${escapeHtml(String(worklog.skills_refined_today))}</span>`
    : "";
  // M1：战绩主行只在今天真有完成量时才显示，否则零活跃新用户首屏会读到「今天我替你扛了 0 件·自主率 0%·约省 0 小时」
  // 这种自夸 0 的尴尬文案（与自进化行的 selfEvolved>0 门同口径）。自进化行独立成立。
  const worklogMainLine = worklog && worklog.accepted_today > 0
    ? `<span>${escapeHtml(goldPathCopyT(locale, "aiHandledToday"))} <b>${escapeHtml(String(worklog.accepted_today))}</b> ${escapeHtml(goldPathCopyT(locale, "doneAutonomy"))} <b title="${escapeHtml(goldPathCopyT(locale, "todaySAiReviewPassRate"))}" data-r9-home-autonomy-note="true">${escapeHtml(String(worklog.autonomy_rate))}%</b> · ${escapeHtml(goldPathCopyT(locale, "saved"))} <b>${escapeHtml(String(worklog.saved_hours_estimate))}</b> ${escapeHtml(goldPathCopyT(locale, "h"))}${zh ? ` <span class="wh-r4-home-kao">٩(◜◡◝)۶</span>` : ""}</span>`
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
        <span class="wh-r4-route-kicker">${escapeHtml(goldPathCopyT(locale, "someDataDidNotLoad"))}</span>
        <div class="wh-r4-route-timeline" role="list">
          ${sourceWarnings.map((warning) => `<p class="wh-subtle" data-r4-home-source-warning-source="${escapeHtml(warning.source)}">${escapeHtml(warning.message)}</p>`).join("")}
        </div>
      </section>`
    : "";

  // P1-07：项目清单是独立于 attention 的并行拉取。projects===undefined 表示这次「加载失败」（not_identified
  // 已在 loader 冒泡去重认证，走到这里的 undefined 是真·取数失败）——显式渲警示条 + 重试，别把失败静默降级成
  // 「项目清单稍后同步」那种像还在加载的软话，也别和「加载成功但 0 个项目」的空态混为一谈。
  const projectsFailedBanner = projects === undefined
    ? `<section class="wh-card wh-r4-route-card wh-r4-home-source-warning" data-r20-home-projects-failed="true" role="alert">
        <span class="wh-r4-route-kicker">${escapeHtml(goldPathCopyT(locale, "projectListFailedToLoad"))}</span>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "onlyTheProjectsAreaIsAffected"))}</p>
        <div class="wh-r4-route-actions">
          <button type="button" class="wh-btn" data-r20-home-projects-retry="true">${escapeHtml(goldPathCopyT(locale, "retryLoadingProjects"))}</button>
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
      <span class="wh-r4-home-chip ${riskCount === 0 ? "wh-r4-home-chip--ok" : "wh-r4-prio--danger"}"><b>${escapeHtml(String(riskCount))}</b>${escapeHtml(riskCount === 0 ? (goldPathCopyT(locale, "risk")) : (goldPathCopyT(locale, "risk2")))}</span>
    </div>`;

  // B-R9.6 §3.7：sync_conflict 主卡的「合并成一条（可编辑）」——merge 动作带 request_json.value_md
  // 合并草稿，这里渲成可编辑文本框；提交时 web 端以框内内容覆盖 value_md（人裁决，不是读转述）。
  const primaryMergeDraft = primary?.kind === "sync_conflict"
    ? primary.actions.find((action) => action.id === "merge_both")?.request_json?.["value_md"]
    : undefined;
  const mergeEditor = typeof primaryMergeDraft === "string"
    ? `<label class="wh-subtle" data-r9-sync-merge-label="true">${escapeHtml(goldPathCopyT(locale, "mergeDraftEditableSubmitViaMerge"))}</label>
       <textarea class="wh-r4-approval-comment-input" data-r9-sync-merge-value="true" rows="3" aria-label="${escapeHtml(goldPathCopyT(locale, "mergedDraftCombiningBothSides"))}">${escapeHtml(primaryMergeDraft)}</textarea>`
    : "";
  const decisionCard = primary
    ? `<section class="wh-card wh-r4-route-card wh-r4-decision" data-r4-home-decision="true">
        <div class="wh-r4-decision-top"></div>
        <div class="wh-r4-route-meta">${homePriorityPill(primary.priority, zh)}${primary.project_name ? `<span class="wh-pill" data-r12-attention-project="true">${escapeHtml(primary.project_name)}</span>` : ""}<span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span></div>
        <h3 role="heading" aria-level="2">${escapeHtml(primary.title)}</h3>
        <p style="white-space:pre-line">${escapeHtml(primary.reason_text ?? primary.summary_text)}</p>
        ${mergeEditor}
        ${evidenceCount > 0 ? `<div class="wh-r4-status"><span>${escapeHtml(zh ? `用到证据 ${evidenceCount} 条` : `${evidenceCount} evidence`)}</span></div>` : ""}
        ${renderActions(primaryActions, locale)}
      </section>`
    : `<section class="wh-card wh-r4-route-card wh-r4-decision" data-r4-home-decision="true">
        <div class="wh-r4-decision-top"></div>
        <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span>
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "home.emptyTitle"))}</h3>
        <p>${escapeHtml(goldPathT(locale, "home.emptySummary"))}</p>
        <div class="wh-r4-route-actions">
          <a class="wh-btn wh-btn-primary" href="/intake" data-wh-route="/intake" data-r4-home-intake-cta="true">${escapeHtml(goldPathT(locale, "home.emptyCta"))}</a>
          <a class="wh-btn" href="/projects" data-wh-route="/projects" data-r4-home-projects-cta="true">${escapeHtml(goldPathCopyT(locale, "browseProjects"))}</a>
        </div>
      </section>`;

  // 普通用户审查 R2：failed/等拍板的 run 曾是不可点死行——给入口（失败/等人→工作项，运行中→回放）。
  const runRows = vm.background_runs.length
    ? vm.background_runs.slice(0, 4).map((run) => {
      const runHref = run.state === "failed" || run.state === "waiting_for_user"
        ? (run.work_item_id ? `/workitems/${run.work_item_id}` : `/agent-runs/${run.run_id}/replay`)
        : `/agent-runs/${run.run_id}/replay`;
      return `<a class="wh-r4-run" href="${escapeHtml(safeHref(runHref))}" data-r4-home-background-run="${escapeHtml(run.run_id)}">
        <div class="wh-r4-run-main"><strong>${escapeHtml(run.title)}</strong><p>${escapeHtml(run.preview_text)}</p></div>
        <span class="wh-pill wh-r4-runstate wh-r4-runstate--${homeRunStateTone(run.state)}">${escapeHtml(homeRunStateLabel(run.state, zh))}</span>
      </a>`;
    }).join("")
    : `<p role="listitem" class="wh-subtle">${escapeHtml(goldPathT(locale, "home.aiWorkingEmpty"))}</p>`;
  // R5（规模化）：多军团并跑时 background_runs 远超 4 条——诚实提示剩余数并给指挥台出路，不再静默截断。
  const runOverflowNote = vm.background_runs.length > 4
    ? `<p class="wh-subtle" data-r9-home-runs-overflow="${escapeHtml(String(vm.background_runs.length - 4))}">${escapeHtml(zh
      ? `还有 ${vm.background_runs.length - 4} 个运行未显示，` : `${vm.background_runs.length - 4} more runs not shown — `)}<a href="/dashboard/agents">${escapeHtml(goldPathCopyT(locale, "seeAllInTheCommandCenter"))}</a></p>`
    : "";
  // 普通用户审查（首页布局）：每天拍板的人不该先滚过两张常青说明卡——决策区提到项目桌之上。
  const decisionGrid = `<div class="wh-r4-route-grid">
        ${decisionCard}
        <section class="wh-card wh-r4-route-card" data-r4-home-ai-working="true">
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.aiWorkingTitle"))}</span>
          <div class="wh-r4-route-timeline" role="list">${runRows}</div>
          ${runOverflowNote}
        </section>
      </div>`;

  const evidenceRows = primary?.evidence_refs?.length
    ? primary.evidence_refs.slice(0, 3).map((ref) => `<div role="listitem" class="wh-r4-route-row" data-r4-home-evidence="${escapeHtml(ref.id)}">
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
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "home.entryTitle"))}</h3>
          ${renderAttentionRows(queueWithoutPrimary, goldPathT(locale, "home.entryText"), locale === "zh-CN")}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-home-evidence-list="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "home.evidenceTitle"))}</h3>
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
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathCopyT(locale, "projectWorkspace"))}</span>
          <h1>${escapeHtml(goldPathCopyT(locale, "projectsDriveAndAttention"))}</h1>
          <p>${escapeHtml(goldPathCopyT(locale, "startFromTheProjectTasksFiles"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(projectCountLabel)}</span>
      </header>
      ${chips}
      ${sourceWarningBanner}
      ${projectsFailedBanner}
      ${decisionGrid}
      <div class="wh-r4-route-grid">
        ${projectDesk}
        <section class="wh-card wh-r4-route-card" data-r8-home-drive-principle="true">
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathCopyT(locale, "fileSync"))}</span>
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "theDriveFollowsTheProject"))}</h3>
          <p>${escapeHtml(goldPathCopyT(locale, "uploadsVersionsDeliverableRestoreAndComment"))}</p>
          <a class="wh-r4-route-kicker" href="${escapeHtml(safeHref(projectDriveHref))}" data-r8-home-drive-principle-link="true">${escapeHtml(goldPathCopyT(locale, "viewProjectDrive"))}</a>
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
    .map((step) => `<div role="listitem" class="wh-r4-route-row" data-r4-intake-progress-step="${escapeHtml(step.key)}" data-r4-intake-progress-state="${escapeHtml(step.state)}">
      <strong>${escapeHtml(step.label)}</strong>
      <span class="wh-pill">${escapeHtml(intakeStepStateLabel(locale, step.state))}</span>
    </div>`)
    .join("");
}

function renderIntakeStartRouteComponent(
  locale: WorkHubLocale,
  project?: { id: string; name: string } | undefined,
  projectUnavailable?: boolean | undefined,
  projects?: ProjectListVM | undefined
): WebRouteComponent {
  const zh = locale === "zh-CN";
  // 普通用户审查：界面写「试点项目」、实际建出英文「Pilot Project」对不上号——按 locale 送本地化名
  // （slug 保持稳定，二次进入仍复用同一项目）。
  const bootstrapPayload = {
    name: goldPathCopyT(locale, "pilotProject"),
    slug: "pilot-project",
    description: goldPathCopyT(locale, "pilotProjectContextCreatedFromThe")
  };
  // 带项目上下文(从项目主页「新任务」进来)：展示真实项目名、绑定到该项目、跳过「试点项目」bootstrap。
  const projectName = project ? project.name : (goldPathCopyT(locale, "pilotProject2"));
  // 文案随是否绑定项目切换——绑定时不再说「准备试点项目」(那条 bootstrap 路径已被跳过)，避免与真实项目名自相矛盾。
  const kicker = project ? (goldPathCopyT(locale, "projectWorkEntry")) : routeT(locale, "intake.startKicker");
  const title = project ? (zh ? `在「${project.name}」里新建任务` : `Start work in ${project.name}`) : routeT(locale, "intake.startTitle");
  const body = project
    ? (goldPathCopyT(locale, "thisTaskBindsDirectlyToThis"))
    : routeT(locale, "intake.startBody");
  const projectCardHeading = project ? (goldPathCopyT(locale, "projectContext")) : routeT(locale, "intake.startProject");
  // start 动作：有项目则带 data-s4b-project-id（browser 据此 createSession 直绑该项目、不 bootstrap）；
  // 无项目则保留原 bootstrap 负载（新建/复用「试点项目」）。两路都走 start_intake 调度。
  // INT-01（评估结论）：主操作保持 <a href="/api/..."> 而非 <button>——classifyGoldPathHref 分发、
  // primaryHrefs 契约（冒烟/探针计数）与样式钩子全挂在 href 上，改 button 面大；委托点击处理器对
  // api-action 一律 preventDefault（不会真导航到 API 地址），这里补 role="button" 把语义摆正
  // （Space 激活由 browser.ts 的 role=button keydown 兜底）。下同（intake.createWorkItem 等）。
  const startAction = project
    ? `<a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" role="button" data-action-id="start_intake" data-method="POST" data-s1-day0-start-intake="true" data-s4b-project-id="${escapeHtml(project.id)}">${escapeHtml(routeT(locale, "intake.startAction"))}</a>`
    : `<a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" role="button" data-action-id="start_intake" data-method="POST" data-s1-day0-start-intake="true" data-request-json="${jsonAttr(bootstrapPayload)}">${escapeHtml(routeT(locale, "intake.startAction"))}</a>`;
  // 来自的项目无法访问(已删/无权限/旧链接)时不静默切换：给一条明确提示，再退化为通用起点。
  const unavailableNotice = projectUnavailable
    ? `<p class="wh-subtle" data-s4b-project-unavailable="true">${escapeHtml(goldPathCopyT(locale, "theProjectYouCameFromIs"))}</p>`
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
        <span class="wh-r4-route-count" data-r8-intake-badge="true">${escapeHtml(goldPathCopyT(locale, "new"))}</span>
      </header>
      ${unavailableNotice}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-s1-day0-project-context-card="true">
          <h3 role="heading" aria-level="2">${escapeHtml(projectCardHeading)}</h3>
          ${!project && (projects?.projects ?? []).length
    ? `<label class="wh-r4-route-stack" data-s4c-intake-project-picker="true">
            <strong>${escapeHtml(goldPathCopyT(locale, "whichProjectDoesThisTaskBelong"))}</strong>
            <select class="wh-pill" data-s4c-intake-project-select="true" aria-label="${escapeHtml(goldPathCopyT(locale, "pickTheProjectForThisTask"))}">
              ${(projects?.projects ?? []).slice(0, 50).map((entry, index) => `<option value="${escapeHtml(entry.id)}"${index === 0 ? " selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}
              <option value="">${escapeHtml(goldPathCopyT(locale, "newPilotProject"))}</option>
            </select>
            <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "sortedByRecentActivityLeavingIt"))}</p>
          </label>`
    : `<div class="wh-r4-route-meta">
            <span class="wh-pill" data-s4b-intake-project-name="${escapeHtml(projectName)}">${escapeHtml(projectName)}</span>
          </div>`}
          <p>${escapeHtml(routeT(locale, "intake.startNext"))}</p>
          <label class="wh-r4-route-stack">
            <strong>${escapeHtml(routeT(locale, "intake.startIntent"))}</strong>
            <textarea class="wh-r4-intake-free-text" data-s1-day1-intent-input="true" maxlength="280" aria-label="${escapeHtml(routeT(locale, "intake.startIntent"))}" placeholder="${escapeHtml(routeT(locale, "intake.startIntentPlaceholder"))}"></textarea>
            <p class="wh-subtle" data-r9-intake-intent-limit="true">${escapeHtml(goldPathCopyT(locale, "upTo280CharactersLeadWith"))}</p>
          </label>
        </section>
        <aside class="wh-r4-route-stack">
          <section class="wh-card wh-r4-route-card" data-s1-day0-intake-evidence="true">
            <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "intake.progress"))}</h3>
            <div class="wh-r4-route-timeline" role="list">
              <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(projectCardHeading)}</strong><span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "ready"))}</span></div>
              <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "intake.summary"))}</strong><span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "next"))}</span></div>
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
        <h3 role="heading" aria-level="2">${escapeHtml(option.label)}</h3>
        <p>${escapeHtml(description)}</p>
      </button>`;
    })
    .join("");
  const freeText = question.free_text.enabled
    ? `<details class="wh-card wh-r4-route-card" data-r4-intake-free-text="true" ${question.free_text.collapsed_by_default ? "" : "open"}>
      <summary>${escapeHtml(routeT(locale, "intake.freeText"))}</summary>
      <p>${escapeHtml(question.free_text.placeholder ?? goldPathT(locale, "intake.freeTextFallback"))}</p>
      <textarea class="wh-r4-intake-free-text" data-intake-free-text-input="true" aria-label="${escapeHtml(question.free_text.placeholder ?? goldPathT(locale, "intake.freeTextFallback"))}" ${question.free_text.max_length ? `maxlength="${escapeHtml(String(question.free_text.max_length))}"` : ""} placeholder="${escapeHtml(question.free_text.placeholder ?? goldPathT(locale, "intake.freeTextFallback"))}"></textarea>
    </details>`
    : "";
  const continuePayload = { selected_option_ids: [] as string[] };
  const createPayload = { session_id: vm.session_id, selected_option_ids: [] as string[] };
  // L11：进度速览卡别把内部管道(SSE topic / stream_href)当药丸暴露给用户;改显「当前在澄清哪一步」这种人话。
  const activeStepLabel = question.progress.find((step) => step.state === "active")?.label ?? "";
  const createAction = question.input_mode === "confirm"
    ? `<a class="wh-btn wh-btn-primary" href="/api/workitems" role="button" data-action-id="create_workitem" data-method="POST" data-intake-create-workitem="true" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(createPayload)}">${escapeHtml(routeT(locale, "intake.createWorkItem"))}</a>`
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
            <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "intake.progress"))}</h3>
            ${activeStepLabel ? `<p class="wh-subtle" data-r4-intake-active-step="true">${escapeHtml(locale === "zh-CN" ? `当前：${activeStepLabel}` : `Now: ${activeStepLabel}`)}</p>` : ""}
            <div class="wh-r4-route-timeline" role="list">${intakeProgressRows(vm, locale)}</div>
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

// R6（信任）：weak/missing 裸标签不可行动——解释「弱在哪、该怎么办」（生产端带 confidence_reason 时优先用它）。
function approvalEvidenceConfidenceExplain(hint: string, zh: boolean): string {
  if (hint === "weak") {
    return goldPathCopyT(zh, "weakEvidenceFewSourcesOrLoosely");
  }
  if (hint === "missing") {
    return goldPathCopyT(zh, "noEvidenceTheAiProvidedNothing");
  }
  return goldPathCopyT(zh, "evidenceFoundVerifiableSourcesSupportThis");
}

function approvalEvidenceConfidenceLabel(hint: string, zh: boolean): string {
  return localizedEnumLabel(
    hint,
    zh,
    { found: "证据充分", weak: "证据较弱", missing: "缺证据" },
    { found: "Found", weak: "Weak", missing: "Missing" }
  );
}

// UI-02：统一走本地时区（formatLocalTimestamp：new Date + 本地分量，形状仍为 YYYY-MM-DD HH:MM）。
// 此前直切 ISO 串 UTC 直出——北京时间下午的事显示成当天上午。无效输入原样返回，渲染层不炸。
function formatApprovalTimestamp(iso: string | undefined): string {
  return formatLocalTimestamp(iso);
}

// R8（留痕）：已处理审批的决策词映射。
function approvalDecisionLabel(decision: string, zh: boolean): string {
  return localizedEnumLabel(
    decision,
    zh,
    { approved: "已通过", allowed: "已通过", rejected: "已打回", denied: "已打回", expired: "已过期", decided: "已处理", delegated: "已转交" },
    { approved: "Approved", allowed: "Approved", rejected: "Sent back", denied: "Sent back", expired: "Expired", decided: "Decided", delegated: "Delegated" }
  );
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
        .map((ev) => `<li>${ev.href ? `<a href="${escapeHtml(safeHref(ev.href))}">${escapeHtml(ev.title)}</a>` : escapeHtml(ev.title)}${ev.excerpt ? `<span class="wh-subtle">${escapeHtml(ev.excerpt)}</span>` : ""}${ev.confidence_hint ? `<span class="wh-pill" data-r4-approval-evidence-confidence="${escapeHtml(ev.confidence_hint)}" title="${escapeHtml(ev.confidence_reason ?? approvalEvidenceConfidenceExplain(ev.confidence_hint, zh))}">${escapeHtml(approvalEvidenceConfidenceLabel(ev.confidence_hint, zh))}</span>${ev.confidence_hint !== "found" ? `<span class="wh-subtle" data-r9-evidence-confidence-note="${escapeHtml(ev.confidence_hint)}"> ${escapeHtml(ev.confidence_reason ?? approvalEvidenceConfidenceExplain(ev.confidence_hint, zh))}</span>` : ""}` : ""}</li>`)
        .join("")}</ul>`
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.evidenceEmpty"))}</p>`;

  const isDeliverable = detail?.kind === "deliverable" && detail.manifest_changes.length > 0;
  const diffSection = isDeliverable
    ? `<section data-r4-approval-diff="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.diffTitle"))}</h4><div class="wh-r4-route-timeline" role="list">${detail.manifest_changes.map((change) => renderChange(change, locale)).join("")}</div></section>`
    : (detail?.affected_targets.length
        ? `<section data-r4-approval-affected="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.affectedTitle"))}</h4><div class="wh-r4-route-meta">${detail.affected_targets.map((target) => `<span class="wh-pill">${escapeHtml(target)}</span>`).join("")}</div></section>`
        : "");
  const checksSection = detail?.checks.length
    ? `<section data-r4-approval-checks="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.checksTitle"))}</h4><div class="wh-r4-route-timeline" role="list">${detail.checks.map((check) => renderCheck(check, locale)).join("")}</div></section>`
    : "";
  const aiSection = (detail?.ai_reason || detail?.expected_benefit || detail?.risk_label || detail?.ai_review_md)
    ? `<section data-r4-approval-ai="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.aiTitle"))}</h4>${detail?.ai_reason ? `<p>${escapeHtml(detail.ai_reason)}</p>` : ""}${detail?.expected_benefit ? `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.benefitTitle"))}: ${escapeHtml(detail.expected_benefit)}</p>` : ""}${detail?.risk_label ? `<span class="wh-pill wh-r4-prio wh-r4-prio--warn">${escapeHtml(detail.risk_label)}</span>` : ""}${detail?.ai_review_md ? `<div data-r9-approval-ai-review="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathCopyT(locale, "aiReviewVerdict"))}</h4><p class="wh-subtle" style="white-space:pre-line">${escapeHtml(detail.ai_review_md)}</p></div>` : ""}</section>`
    : "";
  const conflictsSection = detail?.conflicts.length
    ? `<section data-r4-approval-conflicts="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.conflictsTitle"))}</h4>${detail.conflicts.map((conflict) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-approval-conflict="true"><strong>${escapeHtml(conflict.description)}</strong>${conflict.impact ? `<p class="wh-subtle">${escapeHtml(conflict.impact)}</p>` : ""}${conflict.suggestion ? `<p>${escapeHtml(conflict.suggestion)}</p>` : ""}</div>`).join("")}</section>`
    : "";
  const timelineSection = detail?.timeline.length
    ? `<section data-r4-approval-timeline="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.timelineTitle"))}</h4><div class="wh-r4-route-timeline" role="list">${detail.timeline.map((step) => {
        // L#W2-18：把合成的时间戳/每步 SLA 真正显示出来（之前只算不渲染）。
        const sub = [step.actor_label, formatApprovalTimestamp(step.at)].filter(Boolean).join(" · ");
        return `<div role="listitem" class="wh-r4-route-row" data-r4-approval-timeline-step="${escapeHtml(step.kind)}" data-status="${escapeHtml(step.status)}"><div><strong>${escapeHtml(step.label)}</strong>${sub ? `<p class="wh-subtle">${escapeHtml(sub)}</p>` : ""}</div><div class="wh-r4-route-meta">${step.sla_due_at ? `<span class="wh-pill" data-r4-approval-step-sla="true">${escapeHtml(goldPathCopyT(locale, "due"))}${escapeHtml(formatApprovalTimestamp(step.sla_due_at))}</span>` : ""}<span class="wh-pill">${escapeHtml(approvalStepStatusLabel(step.status, zh))}</span></div></div>`;
      }).join("")}</div></section>`
    : "";
  const comments = detail?.comments ?? [];
  const commentsOverflow = detail?.comments_page_info?.has_more
    ? `<p class="wh-subtle" data-r4-approval-comments-overflow="true">${escapeHtml(goldPathT(locale, "approvals.commentsOverflow"))}</p>`
    : "";
  const commentsSection = `<section data-r4-approval-discussion="true"><h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.discussionTitle"))}</h4>${commentsOverflow}${comments.length
    ? comments.map((comment) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-approval-comment="${escapeHtml(comment.id)}"><strong>${escapeHtml(comment.author_label)}</strong><p style="white-space:pre-line">${escapeHtml(comment.body)}</p></div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.commentsEmpty"))}</p>`}<form class="wh-r4-approval-comment-form" data-r4-approval-comment-form="${escapeHtml(item.id)}"><textarea class="wh-r4-approval-comment-input" data-r4-approval-comment-input rows="2" aria-label="${escapeHtml(goldPathT(locale, "approvals.commentPlaceholder"))}" placeholder="${escapeHtml(goldPathT(locale, "approvals.commentPlaceholder"))}"></textarea><button type="submit" class="wh-btn" data-r4-approval-comment-submit="${escapeHtml(item.id)}">${escapeHtml(goldPathT(locale, "approvals.commentSubmit"))}</button></form></section>`;

  return `<article class="wh-card wh-r4-route-card wh-r4-route-card--accent wh-r4-approval-detail-panel" data-r4-approval-detail-for="${escapeHtml(item.id)}" data-r4-approval-detail-kind="${escapeHtml(detail?.kind ?? "permission")}"${selected ? "" : " hidden"}>
      <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.detailTitle"))}</span>
      <h3 role="heading" aria-level="2">${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary_text)}</p>
      ${item.reason_text ? `<p class="wh-subtle">${escapeHtml(item.reason_text)}</p>` : ""}
      ${diffSection}
      ${checksSection}
      ${aiSection}
      ${conflictsSection}
      <h4 role="heading" aria-level="3">${escapeHtml(goldPathT(locale, "approvals.evidenceTitle"))}</h4>
      ${evidence}
      ${timelineSection}
      ${commentsSection}
      ${item.work_item_id ? `<a class="wh-btn" href="/workitems/${escapeHtml(item.work_item_id)}" data-r4-approval-workitem-link="${escapeHtml(item.work_item_id)}">${escapeHtml(goldPathCopyT(locale, "viewTask"))}</a>` : ""}
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
          <p>${escapeHtml(goldPathCopyT(locale, "whenSomethingNeedsYourCallCuu"))}</p>
        </section>
        <section class="wh-card wh-r4-route-card">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "approvals.ruleTitle"))}</h3>
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
    ? `<div class="wh-r4-route-actions"><a class="wh-btn" href="${escapeHtml(safeHref(nextPageHref))}" data-r4-approval-load-more="true" data-r4-approval-next-page-href="${escapeHtml(safeHref(nextPageHref))}">${escapeHtml(goldPathCopyT(locale, "loadMoreApprovals"))}</a></div>`
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
      // R13（读屏）：行内嵌 checkbox 时容器不能是 role=button（禁止嵌套可交互）——
      // 改用 aria-current 表达「当前选中行」，tabindex+Enter/Space 行为保留。
      return `<article class="wh-card wh-r4-route-card wh-r4-approval-list-item" tabindex="0" aria-current="${escapeHtml(String(item.id === primary?.id))}" data-r4-approval-item="${escapeHtml(item.id)}" data-r12-approval-checkable="true" data-r4-approval-selected="${escapeHtml(String(item.id === primary?.id))}" data-r10-approval-title="${escapeHtml(item.title)}" data-r10-approval-reason="${escapeHtml(item.reason_text ?? "")}"${respondHref ? ` data-r4-approval-respond-href="${escapeHtml(safeHref(respondHref))}"` : ""}>
      <div class="wh-r4-route-meta">${respondHref ? `<input type="checkbox" data-r12-approval-check="${escapeHtml(item.id)}" aria-label="${escapeHtml(goldPathCopyT(locale, "selectForBatchApprove"))}" />` : ""}<span class="wh-pill" data-tone="${escapeHtml(item.priority)}">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span><span class="wh-pill">${escapeHtml(attentionKindLabel(item.kind, zh))}</span>${item.project_name ? `<span class="wh-pill" data-r12-attention-project="true">${escapeHtml(item.project_name)}</span>` : ""}</div>
      <h3 role="heading" aria-level="2">${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary_text)}</p>
      ${itemRequest?.sla_due_at ? `<span class="wh-pill" data-r4-approval-sla="${escapeHtml(item.id)}">${escapeHtml(goldPathCopyT(locale, "due"))}${escapeHtml(formatApprovalTimestamp(itemRequest.sla_due_at))}</span>` : ""}
      ${item.work_item_id ? `<a class="wh-btn" href="/workitems/${escapeHtml(item.work_item_id)}" data-r4-approval-item-link="${escapeHtml(item.id)}">${escapeHtml(goldPathCopyT(locale, "open"))}</a>` : ""}
    </article>`;
    })
    .join("");
  // 中栏：每个事项一张详情面板，仅选中项可见（其余 hidden）。
  const detailPanels = vm.items.length
    ? vm.items.map((item) => renderApprovalDetailPanel(item, vm.items_detail[item.id], locale, item.id === primary?.id)).join("")
    : `<article class="wh-card wh-r4-route-card"><p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.noSelection"))}</p></article>`;
  // 右栏事实区：审批请求路由状态（保留 data-r4-approval-routed / Routed 标记）。
  // R14 批 CHAT（web-avatars）：routed_to_user_id/delegated_to_user_id 在 ApprovalRequest 里一直都有
  // （审批人/委派人），此前只把 routed_to_user_id 拿来算一个"已路由/未路由"的布尔药丸，从没显示过
  // 是路由/委派给了"谁"。两个字段都没有配对的昵称字段可用——只加头像 tile（无姓名回退，图片本身仍
  // 照常尝试加载），不编造一个不存在的名字。委派此前完全没有任何展示点，这里新增一枚同款药丸
  // （data-r14-approval-delegated），只在 delegated_to_user_id 存在时才出现。
  const requestRows = vm.requests
    .map((item) => {
      const routedAvatar = item.routed_to_user_id ? personAvatarTileHtml({ userId: item.routed_to_user_id, label: "" }) : "";
      const delegatedChip = item.delegated_to_user_id
        ? `${personAvatarTileHtml({ userId: item.delegated_to_user_id, label: "" })}<span class="wh-pill" data-r14-approval-delegated="true">${escapeHtml(goldPathCopyT(locale, "delegated"))}</span>`
        : "";
      return `<div role="listitem" class="wh-r4-route-row" data-r4-approval-request="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(approvalActionLabel(item.action_pattern, locale))}</strong>
        <p>${escapeHtml(approvalRequestStatusLabel(item.status, locale === "zh-CN"))}${item.sla_due_at ? ` · ${goldPathCopyT(locale, "due2")} ${escapeHtml(formatApprovalTimestamp(item.sla_due_at))}` : ""}</p>
      </div>
      <div class="wh-r4-route-meta">
        ${routedAvatar}<span class="wh-pill" data-r4-approval-routed="${escapeHtml(String(Boolean(item.routed_to_user_id)))}">${escapeHtml(approvalRouteLabel(item.routed_to_user_id, locale))}</span>
        ${delegatedChip}
      </div>
    </div>`;
    })
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
          <h1 data-r10-approval-headline="true">${escapeHtml(primary?.title ?? goldPathT(locale, "approvals.emptyTitle"))}</h1>
          <p data-r10-approval-headline-reason="true">${escapeHtml(primary?.reason_text ?? goldPathT(locale, "approvals.reasonFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(pendingCount))}</span>
      </header>
      ${pageInfoNote ? `<p class="wh-subtle" data-r4-approval-page-info-note="true">${escapeHtml(pageInfoNote)}</p>` : ""}
      ${nextPageAction}
      <div class="wh-r4-route-grid wh-r4-approvals-grid">
        <section class="wh-r4-route-stack wh-r4-approval-list" data-r4-approval-queue="true">
          ${queueRows || `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(goldPathT(locale, "approvals.reasonFallback"))}</p></article>`}
          ${(vm.decided ?? []).length ? `<details class="wh-card wh-r4-route-card" data-r9-approval-decided="${escapeHtml(String((vm.decided ?? []).length))}">
            <summary class="wh-subtle">${escapeHtml(locale === "zh-CN" ? `最近已处理（${(vm.decided ?? []).length}）` : `Recently decided (${(vm.decided ?? []).length})`)}</summary>
            ${(vm.decided ?? []).slice(0, 10).map((entry) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-approval-decided-item="${escapeHtml(entry.id)}">
              <strong>${escapeHtml(entry.title)}</strong>
              <p class="wh-subtle">${escapeHtml(`${approvalDecisionLabel(entry.decision, locale === "zh-CN")} · ${formatApprovalTimestamp(entry.decided_at)}`)}${entry.reason_md ? `<br/>${escapeHtml(entry.reason_md)}` : ""}</p>
            </div>`).join("")}
          </details>` : ""}
        </section>
        <section class="wh-r4-route-stack wh-r4-approval-detail" data-r4-approval-detail="true">
          ${detailPanels}
        </section>
        <aside class="wh-r4-route-stack wh-r4-approval-actions" data-r4-approval-action-panel="true">
          <section class="wh-card wh-r4-route-card">
            <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "approvals.myActions"))}</h3>
            <button type="button" class="wh-btn" data-r12-approval-batch-approve="true" hidden>${escapeHtml(goldPathCopyT(locale, "approveSelected"))}</button>
            <p class="wh-subtle" data-r12-approval-kbd-hint="true">${escapeHtml(goldPathCopyT(locale, "keysAApproveXSendBack"))}</p>
            ${primary ? renderActions(primary.actions) : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.noSelection"))}</p>`}
            ${primary ? `<label class="wh-r4-approval-field"><span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.reasonLabel"))}</span><textarea class="wh-r4-approval-reason" data-r4-approval-reason rows="2" aria-label="${escapeHtml(goldPathT(locale, "approvals.reasonLabel"))}" placeholder="${escapeHtml(goldPathT(locale, "approvals.reasonPlaceholder"))}"></textarea></label>
            <label class="wh-r4-approval-remember"><input type="checkbox" data-r4-approval-remember /> <span>${escapeHtml(goldPathT(locale, "approvals.rememberLabel"))}</span></label>
            <p class="wh-subtle" data-r4-approval-remember-help="true">${escapeHtml(goldPathT(locale, "approvals.rememberHelp"))}</p>
            ${renderDelegatePicker(locale)}` : ""}
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "approvals.ruleTitle"))}</h3>
            <p>${escapeHtml(goldPathT(locale, "approvals.ruleText"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "approvals.factsTitle"))}</h3>
            <div class="wh-r4-route-timeline" role="list">${requestRows || `<p role="listitem" class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.unrouted"))}</p>`}</div>
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
      return `<div role="listitem" class="wh-r4-route-row" data-r4-workitem-acceptance-item="${escapeHtml(String(record["id"] ?? index))}">
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
  // R10-P1-4：证据是决策依据——截断必须诚实标出「还有 N 条」，不许让审阅者以为已看全。
  const overflow = refs.length > 5
    ? `<p class="wh-subtle" role="listitem" data-${marker}-overflow="${escapeHtml(String(refs.length - 5))}">${escapeHtml(locale === "zh-CN" ? `还有 ${refs.length - 5} 条证据未展开（共 ${refs.length} 条）。` : `${refs.length - 5} more evidence refs not shown (${refs.length} total).`)}</p>`
    : "";
  return refs.slice(0, 5)
    .map((ref) => `<div role="listitem" class="wh-r4-route-row" data-${marker}="${escapeHtml(ref.id)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>
    </div>`)
    .join("") + overflow;
}

// L22：空轨迹/空交付物文案必须看状态。一条「已完成 / 已采纳 / 已取消 / 需要负责人介入」却没留下轨迹的
// 任务，再说「AI 已准备好，下一步会开始读取证据」就和状态徽标直接打架——一无所知的用户没法把「已完成」
// 和「AI 即将开始」对上。终态/升级态给出贴合状态的说明，乐观文案只留给真正还在推进的状态。
function emptyTraceCopy(status: string, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (status === "done" || status === "merged") {
    return goldPathCopyT(locale, "thisWorkItemIsFinishedNo");
  }
  if (status === "cancelled") {
    return goldPathCopyT(locale, "thisWorkItemWasCancelledThere");
  }
  if (status === "escalated") {
    return goldPathCopyT(locale, "needsTheOwnerToStepIn");
  }
  return uiT(locale, "workitem.emptyTrace");
}

function emptyDeliverableCopy(status: string, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (status === "done" || status === "merged") {
    return goldPathCopyT(locale, "thisWorkItemIsFinishedNothing");
  }
  if (status === "cancelled") {
    return goldPathCopyT(locale, "thisWorkItemWasCancelledThere2");
  }
  if (status === "escalated") {
    return goldPathCopyT(locale, "needsTheOwnerToStepIn2");
  }
  return uiT(locale, "workitem.willReadEvidence");
}

function traceRows(vm: WorkItemDetailVM, locale: WorkHubLocale) {
  if (vm.agent_trace_preview.length === 0) {
    return `<p class="wh-subtle" data-r4-workitem-empty-trace-status="${escapeHtml(vm.workitem.status)}">${escapeHtml(emptyTraceCopy(vm.workitem.status, locale))}</p>`;
  }
  return vm.agent_trace_preview.slice(0, 5)
    .map((step) => `<div role="listitem" class="wh-r4-route-row" data-r4-workitem-trace-step="${escapeHtml(step.id)}">
      <div>
        <strong>${escapeHtml(`${step.step_no}. ${agentStepPhaseLabel(locale, step.phase)}`)}</strong>
        <p>${escapeHtml(agentStepPublicSummary(locale, step))}</p>
      </div>
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(step.created_at) || agentStepPhaseLabel(locale, step.phase))}</span>
    </div>`)
    .join("");
}

// R20 R19-27：后端早有跨 run 审计时间线端点（GET /api/workitems/:id/audit，packages/db
// audit-repository 有测试覆盖），但 web 端从没拉过这份数据、更没渲染过——用户看不到一个工作项跨多次
// AI 执行/快照/审批的完整审计轨迹。这里只出静态占位卡（时间线本体是客户端异步拉取，见
// apps/web/src/browser.ts 的 bindWorkItemAuditTimelinePanel），行渲染抽成纯函数以便单测覆盖。

function auditActionLabel(action: string, zh: boolean): string {
  const hit = auditActionLabels[action];
  if (hit) {
    return zh ? hit[0] : hit[1];
  }
  // 未预先收录的动作字符串（新增审计事件类型时难免）不能裸给机器串——退化成分词展示，
  // 至少比 "proposal.merged" 这种没见过的原始 action 值人类友好一些。
  return humanizeToken(action.replace(/[._]/gu, " "));
}

function auditActorLabel(actor: AuditActor, zh: boolean): string {
  if (actor.actor_kind === "ai") {
    return "AI";
  }
  if (actor.actor_nickname) {
    return actor.actor_nickname;
  }
  return goldPathCopyT(zh, "system");
}

const AUDIT_TIMELINE_VISIBLE_COUNT = 8;

// 导出供 browser.ts（web，拉到数据后）与单测复用；纯函数，不做取数——加载中/加载失败/无权三种态
// 由调用方（bindWorkItemAuditTimelinePanel）区分渲染，这里只管「已经有一批审计事实，怎么显示」。
export function renderWorkItemAuditTimelineRows(logs: AuditLogFact[], locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (logs.length === 0) {
    return `<p class="wh-subtle" data-r20-workitem-audit-timeline-empty="true">${escapeHtml(goldPathCopyT(locale, "noAuditHistoryYet"))}</p>`;
  }
  const visible = logs.slice(0, AUDIT_TIMELINE_VISIBLE_COUNT);
  const overflowCount = logs.length - AUDIT_TIMELINE_VISIBLE_COUNT;
  // R10-P1-4 同款约定（evidenceRows）：截断必须诚实标出「还有 N 条」，不许让审阅者以为已看全。
  const overflow = overflowCount > 0
    ? `<p class="wh-subtle" role="listitem" data-r20-workitem-audit-timeline-overflow="${escapeHtml(String(overflowCount))}">${escapeHtml(
        zh
          ? `还有 ${overflowCount} 条审计记录未展开（共 ${logs.length} 条）。`
          : `${overflowCount} more audit entries not shown (${logs.length} total).`
      )}</p>`
    : "";
  return visible
    .map((entry) => `<div role="listitem" class="wh-r4-route-row" data-r20-workitem-audit-entry="${escapeHtml(entry.id)}" data-r20-workitem-audit-entry-action="${escapeHtml(entry.action)}">
      <div>
        <strong>${escapeHtml(auditActionLabel(entry.action, zh))}</strong>
        <p>${escapeHtml(auditActorLabel(entry.actor, zh))}${entry.undone_at ? escapeHtml(goldPathCopyT(locale, "undone")) : ""}</p>
      </div>
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(entry.created_at))}</span>
    </div>`)
    .join("") + overflow;
}

// R23 P4（R20 P2A 端点上界面）：工作区审计流（GET /api/workspace/audit，仅管理员）的对象列——
// entity_type 是库里的机器串（work_item / project / proposal…），直接吐给管理员看没意义，先查表再兜底分词。

function auditEntityLabel(entity: AuditLogFact["entity"], zh: boolean): string {
  const hit = auditEntityTypeLabels[entity.entity_type];
  // A2-36：只说这条记录改的是什么类型的东西。内部 id 认不出是哪一条，且完整值已在 data-* 上可取。
  return hit ? (zh ? hit[0] : hit[1]) : humanizeToken(entity.entity_type.replace(/[._]/gu, " "));
}

// R23 P4：工作区审计流的行渲染（纯函数，供 apps/web 的 bindSettingsWorkspaceAuditPanel 与单测复用）。
// 与工作项审计时间线（renderWorkItemAuditTimelineRows）分开：那边是单个事项的全量，这边是跨事项的
// 分页流——不做本地截断，"还有更多"由服务端分页与「加载更多」按钮表达，否则会和分页口径打架。
export function renderWorkspaceAuditRows(logs: AuditLogFact[], locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (logs.length === 0) {
    return `<p class="wh-subtle" data-r23-workspace-audit-empty="true">${escapeHtml(goldPathCopyT(locale, "noAuditEntriesInThisWorkspace"))}</p>`;
  }
  return logs
    .map((entry) => `<div role="listitem" class="wh-r4-route-row" data-r23-workspace-audit-entry="${escapeHtml(entry.id)}" data-r23-workspace-audit-entry-action="${escapeHtml(entry.action)}" data-r23-workspace-audit-entry-entity="${escapeHtml(entry.entity.entity_id)}">
      <div>
        <strong>${escapeHtml(auditActionLabel(entry.action, zh))}</strong>
        <p>${escapeHtml(`${auditActorLabel(entry.actor, zh)} · ${auditEntityLabel(entry.entity, zh)}`)}${entry.undone_at ? escapeHtml(goldPathCopyT(locale, "undone")) : ""}</p>
      </div>
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(entry.created_at))}</span>
    </div>`)
    .join("");
}

// R23 P4（R20 P2A 端点上界面）：工作项评论流的行渲染（纯函数，供 apps/web 的 bindWorkItemCommentsPanel
// 与单测复用）。服务端按对话顺序（旧→新）返回最多 200 条，详情页默认只展开最近 WORK_ITEM_COMMENT_VISIBLE_COUNT
// 条——更早的用「展开更早的 N 条」按需加载，不做无提示的静默截断。
export const WORK_ITEM_COMMENT_VISIBLE_COUNT = 8;

export function renderWorkItemCommentRows(
  comments: WorkItemComment[],
  locale: WorkHubLocale,
  options: { expanded?: boolean } = {}
): string {
  const zh = locale === "zh-CN";
  if (comments.length === 0) {
    return `<p class="wh-subtle" data-r23-workitem-comments-empty="true">${escapeHtml(goldPathCopyT(locale, "noCommentsOnThisItemYet"))}</p>`;
  }
  const expanded = options.expanded === true;
  const hiddenCount = expanded ? 0 : Math.max(0, comments.length - WORK_ITEM_COMMENT_VISIBLE_COUNT);
  const visible = hiddenCount > 0 ? comments.slice(comments.length - WORK_ITEM_COMMENT_VISIBLE_COUNT) : comments;
  const moreButton = hiddenCount > 0
    ? `<button type="button" class="wh-btn" data-r23-workitem-comments-more="${escapeHtml(String(hiddenCount))}">${escapeHtml(
        zh ? `展开更早的 ${hiddenCount} 条` : `Show ${hiddenCount} earlier`
      )}</button>`
    : "";
  const rows = visible
    .map((comment) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r23-workitem-comment="${escapeHtml(comment.id)}">
      <div>
        <strong>${escapeHtml(comment.author_nickname)}</strong>
        <p>${escapeHtml(comment.body)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(comment.created_at))}</span>
    </div>`)
    .join("");
  return `${moreButton}${rows}`;
}

function workItemAuditTimelineLoadingHtml(locale: WorkHubLocale): string {
  return `<p class="wh-subtle" data-r20-workitem-audit-timeline-loading="true">${escapeHtml(goldPathCopyT(locale, "loadingAuditHistory"))}</p>`;
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
    return goldPathCopyT(locale, "noDependencies");
  }
  const sequenceById = new Map(plan.items.map((candidate, index) => [candidate.id, index + 1]));
  return item.depends_on
    .map((id) => {
      const seq = sequenceById.get(id);
      return seq ? `#${seq}` : (goldPathCopyT(locale, "unknown"));
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
    ? `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-task-plan-awaiting-approval="true">
        <strong>${escapeHtml(goldPathCopyT(locale, "planAwaitingApproval"))}</strong>
        ${reviewHref ? `<a class="wh-pill" href="${escapeHtml(safeHref(reviewHref))}">${escapeHtml(goldPathCopyT(locale, "review"))}</a>` : ""}
      </div>`
    : "";
  const rows = plan.items.length
    ? plan.items.map((item, index) => {
        const dependsLabel = taskPlanDependencyLabel(plan, item, locale);
        const displaySeq = index + 1;
        return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-task-plan-item="${escapeHtml(item.id)}" data-r9-task-plan-role="${escapeHtml(item.role)}" data-r9-task-plan-budget="${escapeHtml(String(item.budget_share_pct))}" data-r9-task-plan-depends="${escapeHtml(dependsLabel)}">
          <div>
            <strong>${escapeHtml(`${displaySeq}. ${item.title}`)}</strong>
            <p>${escapeHtml(stripMarkdown(item.acceptance_md))}</p>
          </div>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(taskPlanItemRoleLabel(locale, item.role))}</span>
            <span class="wh-pill">${escapeHtml(taskPlanItemStatusLabel(locale, item.status))}</span>
            <span class="wh-pill">${escapeHtml(`${item.budget_share_pct}%`)}</span>
            <span class="wh-pill">${escapeHtml(dependsLabel)}</span>
          </div>
        </div>`;
      }).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noSubtasksYet"))}</p>`;
  const capped = plan.items_capped
    ? `<p class="wh-subtle" data-r9-task-plan-items-capped-note="true">${escapeHtml(goldPathCopyT(locale, "showingTheFirst50Subtasks"))}</p>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r9-task-plan-panel="true" data-r9-task-plan-status="${escapeHtml(plan.status)}" data-r9-task-plan-items-capped="${escapeHtml(String(plan.items_capped))}">
    <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "taskPlan"))}</h3>
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(taskPlanStatusLabel(locale, plan.status))}</span>
      <span class="wh-pill">${escapeHtml(uiCount(locale, plan.items.length, "个子任务", "subtask"))}</span>
    </div>
    ${reviewBanner}
    <div class="wh-r4-route-timeline" role="list">${rows}</div>
    ${capped}
  </section>`;
}

function agentTeamTitle(team: WorkItemAgentTeamVM, locale: WorkHubLocale) {
  const ratio = `${team.completed_count}/${team.total_count}`;
  if (team.status === "done") {
    // 有子任务没成也喊「已完成」是撒谎——差额时明说部分完成。
    return team.completed_count < team.total_count
      ? routeTf(locale, "agents.teamPartiallyDone", { ratio })
      : routeTf(locale, "agents.teamCompleted", { ratio });
  }
  // B-R9.6 §3.1：暂停态要在头行说清楚——否则用户按了暂停，面板还喊「推进中」在撒谎。
  if (team.status === "paused") {
    return routeTf(locale, "agents.teamPaused", { ratio });
  }
  if (team.status === "approved") {
    return routeTf(locale, "agents.teamReady", { ratio });
  }
  return routeTf(locale, "agents.teamInProgress", { ratio });
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
          ? `<a class="wh-pill" href="${escapeHtml(safeHref(item.replay_href))}" data-r9-agent-team-trace="${escapeHtml(item.task_plan_item_id)}">${escapeHtml(goldPathCopyT(locale, "viewReplay"))}</a>`
          : "";
        const waiting = item.waiting_for_seq.length
          ? `<p>${escapeHtml(locale === "zh-CN" ? `等待 ${item.waiting_for_seq.map((seq) => `#${seq}`).join(", ")} 完成` : `Waiting for ${item.waiting_for_seq.map((seq) => `#${seq}`).join(", ")}`)}</p>`
          : "";
        const action = item.action
          ? `<a class="wh-pill" href="${escapeHtml(safeHref(item.action.href))}" data-r9-agent-team-action="${escapeHtml(item.action.kind)}">${escapeHtml(item.action.label)}</a>`
          : "";
        const cost = item.cost_estimate_cny
          ? `<span class="wh-pill">${escapeHtml(uiFormatCny(item.cost_estimate_cny, locale))}</span>`
          : "";
        return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-agent-team-item="${escapeHtml(item.task_plan_item_id)}" data-r9-agent-team-status="${escapeHtml(item.status)}" data-r9-agent-team-role="${escapeHtml(item.role)}"${item.waiting_for_seq.length ? ' data-r9-agent-team-waiting="true"' : ""}>
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
    : `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noChildRunsYet"))}</p>`;
  const capped = team.runs_capped
    ? `<p class="wh-subtle" data-r9-agent-team-runs-capped-note="true">${escapeHtml(goldPathCopyT(locale, "showingTheFirst100ChildRuns"))}</p>`
    : "";
  // UX-M13（规格 §1.2）：有子任务等人拍板时面板顶部黄条——「N 个子任务需要你拍板 → 去决策」，
  // 处理完（needs_human 清零）黄条自然消失。
  const needsHumanCount = team.items.filter((item) => item.status === "needs_human").length;
  const decisionBanner = needsHumanCount > 0
    ? `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-agent-team-banner="needs_human" data-r9-task-plan-awaiting-approval="true">
        <strong>${escapeHtml(locale === "zh-CN" ? `${needsHumanCount} 个子任务需要你拍板` : `${needsHumanCount} subtask${needsHumanCount === 1 ? "" : "s"} need${needsHumanCount === 1 ? "s" : ""} your decision`)}</strong>
        <a class="wh-pill" href="/attention">${escapeHtml(goldPathCopyT(locale, "decide"))}</a>
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
        ? `复盘：成功 ${succeeded} · 失败 ${failed} · 跳过 ${skipped} · 花费 ${uiFormatCny(team.cost_used_cny, locale)}`
        : `Retro: ${succeeded} succeeded · ${failed} failed · ${skipped} skipped · spent ${uiFormatCny(team.cost_used_cny, locale)}`;
      return `<p class="wh-subtle" data-r9-agent-team-retro="true">${escapeHtml(summary)}</p>`;
    })()
    : "";
  // B-R9.6 §3.1：头行「暂停派发/恢复派发」次级按钮——VM 给控制才渲，终态军团无按钮。
  const dispatchControl = team.dispatch_control
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(team.dispatch_control.href))}" data-method="${escapeHtml(team.dispatch_control.method)}" data-action-id="${escapeHtml(`${team.dispatch_control.kind}_dispatch`)}" data-r9-agent-team-dispatch-control="${escapeHtml(team.dispatch_control.kind)}" title="${escapeHtml(team.dispatch_control.kind === "pause"
      ? (goldPathCopyT(locale, "stopsNewDispatchesOnlyRunningSubtasks"))
      : (goldPathCopyT(locale, "readySubtasksResumeDispatchingImmediately")))}">${escapeHtml(team.dispatch_control.label)}</a><span class="wh-subtle" data-r9-agent-team-dispatch-hint="true">${escapeHtml(team.dispatch_control.kind === "pause"
      ? (goldPathCopyT(locale, "stopsNewDispatchesRunningOnesFinish"))
      : (goldPathCopyT(locale, "readySubtasksResume")))}</span>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r9-agent-team-panel="true" data-r9-agent-team-plan-id="${escapeHtml(team.plan_id)}" data-r9-agent-team-status="${escapeHtml(team.status)}">
    <div class="wh-r4-route-card-head">
      <h3 role="heading" aria-level="2">${escapeHtml(agentTeamTitle(team, locale))}</h3>
      ${dispatchControl}
    </div>
    <p class="wh-subtle" data-r9-agent-team-role-legend="true">${escapeHtml(goldPathCopyT(locale, "rolesResearchGatherProduceWriteReview"))}</p>
    ${decisionBanner}
    <div class="wh-r4-route-meta">
      <span class="wh-pill" title="${escapeHtml(goldPathCopyT(locale, "totalCostAcrossThisTeamS"))}">${escapeHtml(uiFormatCny(team.cost_used_cny, locale))}</span>
      ${team.cost_budget_cny ? `<span class="wh-pill">${escapeHtml(`${burnPct}%`)}</span>` : ""}
    </div>
    ${team.cost_budget_cny ? `<div class="wh-r4-route-meter" data-r9-agent-team-burn="${escapeHtml(burnTone)}" aria-label="${escapeHtml(`${burnPct}%`)}"><span style="${escapeHtml(burnStyle)}"></span></div>` : ""}
    <div class="wh-r4-route-timeline" role="list">${rows}</div>
    ${retroLine}
    ${capped}
  </section>`;
}

// M15：某些状态(已升级/进行中/待审阅/终态…)在无变更申请、无运行、非待派活时本就没有用户动作。
// 别留一个零按钮零说明的死卡——按状态给一句「为什么没动作 + 接下来会怎样」的说明。
function workItemActionHint(status: string, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    intake: ["AI 正在接收这条需求，稍后会请你澄清。", "AI is taking in this request; it will ask you to clarify soon."],
    ai_clarifying: ["AI 正在和你澄清任务细节，去「新任务」入口继续。", "AI is clarifying the task with you — continue from the new-task entry."],
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
  return entry ? (zh ? entry[0] : entry[1]) : (goldPathCopyT(zh, "nothingNeedsYourActionRightNow"));
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
    return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-workitem-source-context="${escapeHtml(source.source_type)}" data-r5-workitem-source-comment-id="${escapeHtml(source.comment_id)}" data-r5-workitem-source-proposal-id="${escapeHtml(source.proposal_id ?? "")}" data-r5-workitem-create-proposal-action="${escapeHtml(String(Boolean(vm.actions.create_proposal_draft)))}">
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
  // R13 批 P4（观察者工单来源标注）：与 drive_comment/meeting_insight 平级——会话观察者创建的工单没有
  // 评论/纪要正文可显示，只人话标注「由哪场会话创建」，且没有 web 端可达的会话深链（桌面优先战略）。
  if (source.source_type === "conversation_observer") {
    return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-workitem-source-context="${escapeHtml(source.source_type)}" data-r13-workitem-source-conversation-id="${escapeHtml(source.conversation_id)}">
      <div>
        <strong>${escapeHtml(routeT(locale, "workitem.observerSource"))}</strong>
        <p>${escapeHtml(routeT(locale, "workitem.observerSourceBody"))}</p>
      </div>
    </div>`;
  }
  const proposal = source.proposal_href
    ? `<a class="wh-pill" href="${escapeHtml(safeHref(source.proposal_href))}" data-r5-workitem-source-proposal-link="true" data-r5-workitem-source-proposal-id="${escapeHtml(source.proposal_id ?? "")}" data-r5-workitem-source-proposal-status="${escapeHtml(source.proposal_status ?? "")}">${escapeHtml(routeT(locale, "workitem.openProposal"))}</a>`
    : "";
  const evidence = source.evidence_refs.length
    ? source.evidence_refs.slice(0, 3).map((ref) => `<span class="wh-pill" data-r5-workitem-source-evidence="${escapeHtml(ref.id)}">${escapeHtml(ref.title)}</span>`).join("")
    : "";
  return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-workitem-source-context="${escapeHtml(source.source_type)}" data-r5-workitem-source-meeting-id="${escapeHtml(source.meeting_id)}" data-r5-workitem-source-insight-id="${escapeHtml(source.insight_id)}" data-r5-workitem-source-proposal-id="${escapeHtml(source.proposal_id ?? "")}" data-r5-workitem-create-proposal-action="${escapeHtml(String(Boolean(vm.actions.create_proposal_draft)))}">
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

// R23 P4（R20 P2A 端点上界面）：工作项「负责人与协作」卡。POST /api/workitems/:id/{claim,assign} 服务端
// 早已齐备（work-item-assignment.ts），此前两端一个入口都没有。资格由详情页 VM 的 can_claim / can_assign
// 下发（服务端用与写端点完全相同的谓词算），没资格就不渲那个按钮——不渲一个点下去必定 403 的假入口。
// 指派对象选择器沿用审批转交的既有做法：折叠的 <details>，展开时才去拉本工作区花名册（不进首屏 loader）。
function renderWorkItemAssignmentCard(vm: WorkItemDetailVM, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const claimedNickname = vm.workitem.claimed_by_nickname ?? "";
  const currentLine = vm.workitem.claimed_by_user_id
    ? `<div role="listitem" class="wh-r4-route-row" data-r23-workitem-assignment-current="${escapeHtml(vm.workitem.claimed_by_user_id)}">
        <div><strong>${escapeHtml(goldPathCopyT(locale, "whoSOnIt"))}</strong><p>${escapeHtml(claimedNickname || (goldPathCopyT(locale, "claimed")))}</p></div>
        ${personAvatarTileHtml({ userId: vm.workitem.claimed_by_user_id, label: claimedNickname })}
      </div>`
    : `<p class="wh-subtle" data-r23-workitem-assignment-unclaimed="true">${escapeHtml(goldPathCopyT(locale, "nobodyHasPickedThisItemUp"))}</p>`;
  // 指派名单：POST /api/workitems/:id/assign 写的是 work_item_assignments，不是认领人——不把它渲出来，
  // 指派成功后这张卡会毫无变化。服务端已按 lead 优先排好序；名字缺席（账号被硬删）时只说角色，不吐裸 id。
  const assigneeRows = (vm.assignees ?? [])
    .map((assignee) => {
      const roleLabel = assignee.role === "lead" ? (goldPathCopyT(locale, "lead")) : (goldPathCopyT(locale, "collaborator"));
      const name = assignee.nickname ?? (goldPathCopyT(locale, "removedMember"));
      return `<div role="listitem" class="wh-r4-route-row" data-r23-workitem-assignee="${escapeHtml(assignee.user_id)}" data-r23-workitem-assignee-role="${escapeHtml(assignee.role)}">
        <div><strong>${escapeHtml(name)}</strong><p>${escapeHtml(roleLabel)}</p></div>
        ${assignee.nickname ? personAvatarTileHtml({ userId: assignee.user_id, label: assignee.nickname }) : ""}
      </div>`;
    })
    .join("");
  const assigneeBlock = assigneeRows
    ? `<p class="wh-subtle" data-r23-workitem-assignees="true">${escapeHtml(goldPathCopyT(locale, "assignedTo"))}</p><div class="wh-r4-route-table">${assigneeRows}</div>`
    : "";
  const claimButton = vm.can_claim === true
    ? `<button type="button" class="wh-btn wh-btn-primary" data-r23-workitem-claim="true">${escapeHtml(goldPathCopyT(locale, "claimIt"))}</button>`
    : "";
  const assignBlock = vm.can_assign === true
    ? `<details class="wh-r4-approval-field" data-r23-workitem-assign="true">
        <summary>${escapeHtml(goldPathCopyT(locale, "assignTo"))}</summary>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "handThisItemToATeammate"))}</p>
        <select class="wh-pill" data-r23-workitem-assign-select="true" aria-label="${escapeHtml(goldPathCopyT(locale, "pickAnAssignee"))}"><option value="">${escapeHtml(goldPathCopyT(locale, "membersLoadOnOpen"))}</option></select>
        <select class="wh-pill" data-r23-workitem-assign-role="true" aria-label="${escapeHtml(goldPathCopyT(locale, "pickARole"))}">
          <option value="collaborator">${escapeHtml(goldPathCopyT(locale, "collaborator"))}</option>
          <option value="lead">${escapeHtml(goldPathCopyT(locale, "lead"))}</option>
        </select>
        <div class="wh-r4-route-actions"><button type="button" class="wh-btn" data-r23-workitem-assign-submit="true">${escapeHtml(goldPathCopyT(locale, "assign"))}</button></div>
      </details>`
    : "";
  const noActionNote = !claimButton && !assignBlock
    ? `<p class="wh-subtle" data-r23-workitem-assignment-readonly="true">${escapeHtml(goldPathCopyT(locale, "youCanSeeWhoOwnsThis"))}</p>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r23-workitem-assignment="true" data-r23-workitem-assignment-workitem="${escapeHtml(vm.workitem.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "ownerCollaborators"))}</h3>
        <div class="wh-r4-route-table">${currentLine}</div>
        ${assigneeBlock}
        ${claimButton ? `<div class="wh-r4-route-actions">${claimButton}</div>` : ""}
        ${assignBlock}
        ${noActionNote}
        <p class="wh-subtle" data-r23-workitem-assignment-status="true" hidden></p>
      </section>`;
}

// R23 P4（R20 P2A 端点上界面）：工作项评论区。GET/POST /api/workitems/:id/comments 服务端早已齐备
// （work-item-comments.ts），此前两端零界面。列表是客户端按需水合（详情页 VM 不带评论，也不该为了
// 一段讨论把整页 VM 撑大）；取数失败要显式可见并可重试，绝不用「还没有人留言」糊弄一次真实的失败。
function renderWorkItemCommentsCard(vm: WorkItemDetailVM, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  return `<section class="wh-card wh-r4-route-card" data-r23-workitem-comments="true" data-r23-workitem-comments-workitem="${escapeHtml(vm.workitem.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "discussion"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "anyoneWhoCanSeeThisItem"))}</p>
        <div class="wh-r4-route-timeline" role="list" data-r23-workitem-comments-body="true"><p class="wh-subtle" data-r23-workitem-comments-loading="true">${escapeHtml(goldPathCopyT(locale, "loadingDiscussion"))}</p></div>
        <form data-r23-workitem-comment-form="true">
          <textarea class="wh-pill" style="width:100%;box-sizing:border-box;resize:vertical" rows="3" maxlength="${WORK_ITEM_COMMENT_MAX_CHARS}" data-r23-workitem-comment-input="true" aria-label="${escapeHtml(goldPathCopyT(locale, "writeAComment"))}" placeholder="${escapeHtml(goldPathCopyT(locale, "writeAComment2"))}"></textarea>
          <p class="wh-subtle" data-r23-workitem-comment-status="true" hidden></p>
          <div class="wh-r4-route-actions"><button type="submit" class="wh-btn" data-r23-workitem-comment-submit="true">${escapeHtml(goldPathCopyT(locale, "postComment"))}</button></div>
        </form>
      </section>`;
}

function renderWorkItemRouteComponent(vm: WorkItemDetailVM, locale: WorkHubLocale): WebRouteComponent {
  const title = vm.workitem.title ?? vm.workitem.code;
  const summary = stripMarkdown(vm.workitem.summary_md ?? vm.workitem.raw_description ?? uiT(locale, "workitem.defaultSummary"));
  const actions = workItemActions(vm, locale);
  const latestProposal = vm.latest_proposal;
  const deliverableRows = latestProposal?.changes.length
    ? latestProposal.changes.slice(0, 4).map((change) => `<div role="listitem" class="wh-r4-route-row" data-r4-workitem-deliverable-change="${escapeHtml(change.id)}">
      <div>
        <strong>${escapeHtml(change.human_summary)}</strong>
        <p>${escapeHtml(change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
    </div>`).join("")
    : `<p class="wh-subtle" data-r4-workitem-empty-deliverable-status="${escapeHtml(vm.workitem.status)}">${escapeHtml(emptyDeliverableCopy(vm.workitem.status, locale))}</p>`;
  // R13 批 P4（全托管透明度：reviewer_kind 溯源）：只要有一条已采纳交付物是 AI 自己复核并合并的
  // （reviewer_kind==="ai"），说明这个工作项确实发生过「全托管自动合并」——把握度 pill 上补一条
  // 过去时的「已自动采纳」，对已发生的事实用事实语气；未发生时只显示把握度三句话，不预告资格。
  const hasAiAutoMergedDeliverable = vm.accepted_deliverables.some((accepted) => accepted.reviewer_kind === "ai");
  // R14 批 CHAT（web-avatars）：claimed_by_user_id/claimed_by_nickname 一直在 WorkItem 契约里
  // （apps/api/src/services/work-items.ts 早就在填），但 web 端此前从没渲过——工单详情页从没说过
  // 「这活现在是谁在认领」。PM 点名「工单详情的负责人」要带头像，这里把文字与头像一起新增
  // （不是给已有文字加图，是把这块本来就有数据却从没显示的信息补上），只在有人认领时出现。
  const claimedByPill = vm.workitem.claimed_by_user_id
    ? `${personAvatarTileHtml({ userId: vm.workitem.claimed_by_user_id, label: vm.workitem.claimed_by_nickname ?? "" })}<span class="wh-pill" data-r14-workitem-claimed-by="true">${escapeHtml(`${goldPathCopyT(locale, "assignee")} · ${vm.workitem.claimed_by_nickname ?? "?"}`)}</span>`
    : "";

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
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "workitem.context"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(vm.workitem.code)}</span>
            ${claimedByPill}
            <span class="wh-pill">${escapeHtml(attentionPriorityLabel(vm.workitem.priority, locale === "zh-CN"))}</span>
            <span class="wh-pill">${escapeHtml(localizedEnumLabel(vm.workitem.mode, locale === "zh-CN", { worker: "执行", pm: "项目管理" }, { worker: "Worker", pm: "PM" }))}</span>
            ${vm.confidence ? `<span class="wh-pill wh-r4-prio ${vm.confidence.verdict === "escalate" ? "wh-r4-prio--warn" : ""}" data-r9-workitem-confidence="${escapeHtml(vm.confidence.verdict)}" data-r13-workitem-confidence-auto-merged="${escapeHtml(String(vm.confidence.verdict === "auto_merge" && hasAiAutoMergedDeliverable))}" title="${escapeHtml(goldPathCopyT(locale, "howConfidentAiIsAboutIts"))}">${escapeHtml(locale === "zh-CN"
    ? `${vm.confidence.score >= 0.85 ? "我比较有把握" : vm.confidence.score >= 0.6 ? "建议你扫一眼" : "我拿不准，你来定"}${vm.confidence.verdict === "auto_merge" && hasAiAutoMergedDeliverable ? " · 已自动采纳" : ""}`
    : `${vm.confidence.score >= 0.85 ? "I'm fairly confident" : vm.confidence.score >= 0.6 ? "Worth a quick look" : "I'm not sure — your call"}${vm.confidence.verdict === "auto_merge" && hasAiAutoMergedDeliverable ? " · Auto-adopted" : ""}`)}</span>` : ""}
          </div>
          ${vm.confidence ? `<p class="wh-subtle" data-r9-workitem-confidence-note="true">${escapeHtml(goldPathCopyT(locale, "howConfidentAiIsAboutIts2"))}</p>` : ""}
          ${(() => {
    // L25：上下文卡正文别和头部 summary 重复(都源自 raw_description 时)；两者都空也别渲一个空 <p>。
    const body = vm.workitem.planning_note ?? vm.workitem.raw_description ?? "";
    return body && stripMarkdown(body) !== summary ? `<p>${escapeHtml(body)}</p>` : "";
  })()}
          ${renderWorkItemSourceContext(vm, locale)}
          ${(vm.approval_decisions ?? []).length ? `<div data-r9-workitem-approval-decisions="${escapeHtml(String((vm.approval_decisions ?? []).length))}">
            <p class="wh-subtle"><strong>${escapeHtml(goldPathCopyT(locale, "approvalHistory"))}</strong></p>
            ${(vm.approval_decisions ?? []).map((decision) => `<p class="wh-subtle" data-r9-workitem-approval-decision="${escapeHtml(decision.id)}">${escapeHtml(`${approvalDecisionLabel(decision.decision, locale === "zh-CN")} · ${formatApprovalTimestamp(decision.decided_at)}`)}${decision.reason_md ? escapeHtml(` · ${decision.reason_md.slice(0, 120)}`) : ""}</p>`).join("")}
          </div>` : ""}
          ${actions.length
    ? renderActions(actions)
    : `<p class="wh-subtle" data-r4-workitem-action-hint="${escapeHtml(vm.workitem.status)}">${escapeHtml(workItemActionHint(vm.workitem.status, locale === "zh-CN"))}</p>`}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-deliverables="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "workitem.deliverables"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${deliverableRows}</div>
          ${vm.accepted_deliverables.length ? `<h4 role="heading" aria-level="3">${escapeHtml(goldPathCopyT(locale, "acceptedDeliverables"))}</h4>
          <div class="wh-r4-route-timeline" role="list">${vm.accepted_deliverables.slice(0, 6).map((accepted) => `<div role="listitem" class="wh-r4-route-row" data-r9-workitem-accepted-deliverable="${escapeHtml(accepted.change_id)}" data-r13-workitem-accepted-reviewer-kind="${escapeHtml(accepted.reviewer_kind ?? "")}">
            <div>
              <strong>${escapeHtml(accepted.filename ?? accepted.target_path ?? accepted.target_key)}</strong>
              ${accepted.reviewer_kind === "ai" ? `<p class="wh-subtle" data-r13-workitem-accepted-auto-merge-notice="true">${escapeHtml(goldPathCopyT(locale, "automaticallyMergedByAiNoHuman"))}</p>` : ""}
            </div>
            <div class="wh-r4-route-meta">
              ${accepted.drive_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(accepted.drive_href))}" data-r9-accepted-drive-link="true">${escapeHtml(goldPathCopyT(locale, "openInDrive"))}</a>` : ""}
              ${accepted.download_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(accepted.download_href))}" data-action-id="drive_download" data-native-resource-link="true" target="_blank" rel="noreferrer">${escapeHtml(goldPathCopyT(locale, "download"))}</a>` : ""}
            </div>
          </div>`).join("")}</div>${vm.accepted_deliverables.length > 6 ? `<p class="wh-subtle" data-r11-accepted-overflow="${escapeHtml(String(vm.accepted_deliverables.length - 6))}">${escapeHtml(locale === "zh-CN" ? `还有 ${vm.accepted_deliverables.length - 6} 条已采纳交付物，去网盘查看全部。` : `${vm.accepted_deliverables.length - 6} more accepted deliverables — see all in the drive.`)}</p>` : ""}` : ""}
        </section>
      </div>
      ${renderWorkItemPlanSlot(vm, latestProposal, locale)}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-workitem-acceptance="true">
          <h3 role="heading" aria-level="2">${escapeHtml(uiT(locale, "workitem.acceptanceTitle"))}</h3>
          <div class="wh-r4-route-table">${acceptanceRows(vm.acceptance, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-trace="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "workitem.trace"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${traceRows(vm, locale)}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        ${renderWorkItemAssignmentCard(vm, locale)}
        ${renderWorkItemCommentsCard(vm, locale)}
      </div>
      <section class="wh-card wh-r4-route-card" data-r4-workitem-evidence="true">
        <h3 role="heading" aria-level="2">${escapeHtml(uiT(locale, "generic.evidence"))}</h3>
        <div class="wh-r4-route-timeline" role="list">${evidenceRows(vm.evidence_refs, locale, "r4-workitem-evidence-ref")}</div>
      </section>
      <section class="wh-card wh-r4-route-card" data-r20-workitem-audit-timeline="true" data-r20-workitem-audit-timeline-workitem="${escapeHtml(vm.workitem.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "crossRunAuditTimeline"))}</h3>
        <div class="wh-r4-route-timeline" role="list" data-r20-workitem-audit-timeline-body="true">${workItemAuditTimelineLoadingHtml(locale)}</div>
      </section>
    </section>`
  });
}

function renderChange(change: DeliverableChange, locale: WorkHubLocale) {
  const path = change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type;
  // R10-P1-3：预览链接此前是裸 <a>——被 api-action 分发拦下 preventDefault 后没有任何处理器认领，
  // 点了只弹「处理中」。download 类走原生下载（照抄 drive_download），其余接既有 drive_preview
  // JSON 预览面板管线（drive 路由外会退化为 notice 内嵌面板，通用可用）。
  const preview = change.preview_ref
    ? (change.preview_ref.kind === "download"
      ? `<a class="wh-pill" href="${escapeHtml(safeHref(change.preview_ref.href))}" data-action-id="drive_download" data-native-resource-link="true" target="_blank" rel="noreferrer">${escapeHtml(previewKindLabel(locale, change.preview_ref.kind))}</a>`
      : `<a class="wh-pill" href="${escapeHtml(safeHref(change.preview_ref.href))}" data-action-id="drive_preview" data-r4-proposal-change-preview="true">${escapeHtml(previewKindLabel(locale, change.preview_ref.kind))}</a>`)
    : "";
  return `<div role="listitem" class="wh-r4-route-row" data-r4-proposal-change="${escapeHtml(change.id)}" data-r4-proposal-change-kind="${escapeHtml(change.target_kind)}" data-r4-proposal-change-type="${escapeHtml(change.change_type)}">
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
  return `<div role="listitem" class="wh-r4-route-row" data-r4-proposal-check="${escapeHtml(check.id)}" data-r4-proposal-check-status="${escapeHtml(check.status)}">
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
    return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-plan-item="${escapeHtml(item.id)}" data-r9-plan-item-role="${escapeHtml(item.role)}">
      <div>
        <strong>#${index + 1} ${escapeHtml(item.title)}</strong>
        <p style="white-space:pre-line">${escapeHtml(goldPathCopyT(locale, "acceptance"))}${escapeHtml(stripMarkdown(item.acceptance_md))}</p>
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
    ? `<p class="wh-subtle" data-r9-plan-share-total="100">${escapeHtml(goldPathCopyT(locale, "budgetSharesAddUpTo100"))}</p>`
    : `<p class="wh-pill-danger" data-r9-plan-share-total="${escapeHtml(String(totalShare))}" data-r9-plan-share-invalid="true">${escapeHtml(
      totalShare < 100
        ? routeTf(locale, "plan.shareShort", { total: totalShare, delta: 100 - totalShare })
        : routeTf(locale, "plan.shareOver", { total: totalShare, delta: totalShare - 100 })
    )}</p>`;
  return `<section class="wh-card wh-r4-route-card" data-r9-plan-items="true" data-r9-plan-item-count="${escapeHtml(String(ordered.length))}">
      <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "subtasks"))}</h3>
      <div class="wh-r4-route-timeline" role="list">${rows}</div>
      ${shareNote}
    </section>`;
}

// R14 批 FEEDBACK（web-feedback-ui）：提议详情页「这条提议对你有帮助吗」轻反馈——服务端已经算好
// mark_useful/mark_not_useful/clear 三个动作的 href/method/request_json（buildProposalFeedbackVm，
// apps/api/src/pages/proposals.ts），本函数只管渲染点击，照 review_actions 的既有风格（04-feedback-
// design.md §7.2）。字符 tile 用 ✓/✗（U+2713/U+2717 排版符号，不是 emoji——§8 的第四层视觉语言，
// 不复用 REACTION_EMOJI 的豁免边界）。
// clear 链接始终渲染（不像 mark_useful/mark_not_useful 那样等 vm.feedback.clear 存在才出现）——
// 用 hidden 属性按 my_verdict 控制可见性，而不是等客户端把新节点插进 DOM：这样 bindGoldPathNavigation
// 里乐观切换判定后只需要翻 hidden，不用现造一个新锚点元素（那条路径更脆——插入位置、事件委托的
// closest("a[href]") 都要重新对齐）。href/method 与 mark_useful 完全一致（buildProposalFeedbackVm
// 里三个动作共用同一个 /api/proposals/:id/feedback 端点，唯一变量是 method）。
function renderProposalFeedbackHtml(
  feedback: NonNullable<ProposalDetailVM["feedback"]>,
  locale: WorkHubLocale
): string {
  const zh = locale === "zh-CN";
  const tile = (action: ActionSpec, verdict: "useful" | "not_useful", glyph: string, on: boolean) => {
    const requestJson = action.request_json ? ` data-request-json="${jsonAttr(action.request_json)}"` : "";
    return `<a class="wh-r14-proposal-feedback-tile${on ? " wh-r14-proposal-feedback-tile--on" : ""}" href="${escapeHtml(safeHref(action.href))}" data-action-id="${escapeHtml(action.id)}" data-method="${escapeHtml(action.method)}"${requestJson} data-r14-proposal-feedback-tile="${verdict}" role="button" aria-pressed="${on ? "true" : "false"}"><span class="wh-r14-proposal-feedback-glyph" aria-hidden="true">${glyph}</span><span>${escapeHtml(action.label)}</span></a>`;
  };
  const clearHref = feedback.clear?.href ?? feedback.mark_useful.href;
  const clearLabel = feedback.clear?.label ?? (goldPathCopyT(locale, "clearFeedback"));
  const clearId = feedback.clear?.id ?? "clear_feedback";
  const clearMethod = feedback.clear?.method ?? "DELETE";
  const clearHidden = feedback.my_verdict === null ? " hidden" : "";
  const noteValue = feedback.my_note ?? "";
  const noteDisabled = feedback.my_verdict === null ? " disabled" : "";
  return `<section class="wh-card wh-r4-route-card wh-r14-proposal-feedback" data-r14-proposal-feedback="true" data-r14-proposal-feedback-verdict="${escapeHtml(feedback.my_verdict ?? "")}">
      <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "wasThisProposalHelpful"))}</h3>
      <div class="wh-r14-proposal-feedback-tiles" role="group" aria-label="${escapeHtml(goldPathCopyT(locale, "feedback"))}">
        ${tile(feedback.mark_useful, "useful", "✓", feedback.my_verdict === "useful")}
        ${tile(feedback.mark_not_useful, "not_useful", "✗", feedback.my_verdict === "not_useful")}
        <a class="wh-r14-proposal-feedback-clear" href="${escapeHtml(safeHref(clearHref))}" data-action-id="${escapeHtml(clearId)}" data-method="${escapeHtml(clearMethod)}" data-r14-proposal-feedback-clear="true" role="button"${clearHidden}>${escapeHtml(clearLabel)}</a>
      </div>
      <div class="wh-r14-proposal-feedback-note" data-r14-proposal-feedback-note-panel="true">
        <label class="wh-subtle" for="wh-r14-proposal-feedback-note-input">${escapeHtml(goldPathCopyT(locale, "noteOptionalUpTo200Characters"))}</label>
        <textarea id="wh-r14-proposal-feedback-note-input" class="wh-r14-proposal-feedback-note-input" data-r14-proposal-feedback-note-input maxlength="200" placeholder="${escapeHtml(goldPathCopyT(locale, "whatWorkedOrDidnTAbout"))}">${escapeHtml(noteValue)}</textarea>
        <div class="wh-r14-proposal-feedback-note-actions">
          <button type="button" class="wh-btn" data-r14-proposal-feedback-note-save${noteDisabled}>${escapeHtml(goldPathCopyT(locale, "saveNote"))}</button>
          <span class="wh-subtle" data-r14-proposal-feedback-note-status hidden></span>
        </div>
      </div>
    </section>`;
}

function renderProposalRouteComponent(
  vm: ProposalDetailVM,
  locale: WorkHubLocale,
  conflicts: ProposalConflict[] = [],
  conflictsCheckFailed = false
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
  const summaryFull = stripMarkdown(vm.manifest.summary_md);
  // R4：硬切断像渲染 bug——超长补省略号。
  // R7：按码点截断——UTF-16 code unit 硬切会把 emoji surrogate pair 切成乱码。
  const summaryPoints = [...summaryFull];
  const summaryTruncated = summaryPoints.length > 320;
  const summary = summaryTruncated ? `${summaryPoints.slice(0, 320).join("")}…` : summaryFull;
  // R10-P1-4：截断了就明说截断了——省略号太容易被当成原文结尾。
  const summaryNote = summaryTruncated
    ? `<span class="wh-subtle" data-r10-proposal-summary-truncated="${escapeHtml(String(summaryPoints.length))}">${escapeHtml(locale === "zh-CN" ? `（摘要已截断，全文约 ${summaryPoints.length} 字）` : ` (summary truncated — about ${summaryPoints.length} characters in full)`)}</span>`
    : "";
  const rollbackClass = vm.manifest.rollback.available ? "wh-pill" : "wh-pill wh-pill-danger";
  const comments = vm.comments.length
    ? vm.comments.map((comment) => `<div role="listitem" class="wh-r4-route-row" data-r4-proposal-comment="${escapeHtml(comment.id)}">
      <div>
        <strong>${escapeHtml(comment.author_label)}</strong>
        <p style="white-space:pre-line">${escapeHtml(comment.body)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(comment.created_at))}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noCommentsYet"))}</p>`;
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
          <span class="wh-r4-route-kicker">${escapeHtml(vm.manifest.changes.some((change) =>
            change.target_kind === "structured_record" && change.target_ref.entity_type === "task_plan")
            ? (goldPathCopyT(locale, "taskPlanProposal"))
            : uiT(locale, "proposal.kicker"))}</span>
          <h1>${escapeHtml(vm.title)}</h1>
          <p>${escapeHtml(summary)}${summaryNote}</p>
        </div>
        <span class="wh-r4-route-count" data-r4-proposal-status="${escapeHtml(vm.status)}">${escapeHtml(proposalStatusLabel(locale, vm.status))}</span>
      </header>
      ${vm.feedback ? renderProposalFeedbackHtml(vm.feedback, locale) : ""}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-proposal-summary="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "proposal.summary"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(uiT(locale, "generic.risk"))}: ${escapeHtml(vm.manifest.risk.human_label)}</span>
            <span class="${rollbackClass}" data-r4-proposal-rollback-available="${escapeHtml(String(vm.manifest.rollback.available))}">${escapeHtml(vm.manifest.rollback.available ? uiT(locale, "proposal.rollbackAvailable") : uiT(locale, "proposal.rollbackUnavailable"))}</span>
          </div>
          <p>${escapeHtml(vm.manifest.rollback.description)}</p>
          ${renderActions(actions)}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-proposal-review="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "proposal.review"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${vm.manifest.checks.slice(0, 8).map((check) => renderCheck(check, locale)).join("")}${vm.manifest.checks.length > 8 ? `<p class="wh-subtle" role="listitem" data-r10-proposal-checks-overflow="${escapeHtml(String(vm.manifest.checks.length - 8))}">${escapeHtml(locale === "zh-CN" ? `还有 ${vm.manifest.checks.length - 8} 项检查未展开（共 ${vm.manifest.checks.length} 项）。` : `${vm.manifest.checks.length - 8} more checks not shown (${vm.manifest.checks.length} total).`)}</p>` : ""}</div>
        </section>
      </div>
      ${renderTaskPlanItemsPanel(vm, locale)}
      ${conflictsCheckFailed ? `<section class="wh-card wh-r4-route-card" data-r10-proposal-conflicts-check-failed="true">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "conflictCheckUnavailable"))}</h3>
        <p>${escapeHtml(goldPathCopyT(locale, "weCouldnTVerifyWhetherThis"))}</p>
      </section>` : ""}
      <section class="wh-card wh-r4-route-card" data-r4-proposal-changes="true">
        <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "proposal.files"))}</h3>
        <div class="wh-r4-route-table">${vm.manifest.changes.map((change) => renderChange(change, locale)).join("")}</div>
      </section>
      ${advancedConflictReview}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-proposal-evidence="true">
          <h3 role="heading" aria-level="2">${escapeHtml(uiT(locale, "generic.evidence"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${evidenceRows(vm.evidence_refs, locale, "r4-proposal-evidence-ref")}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-proposal-comments="true">
          <h3 role="heading" aria-level="2">${escapeHtml(uiT(locale, "proposal.comments"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${comments}</div>
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

// R14（网盘回滚两端对齐）：version.restore_href 在真实数据里只会挂在服务端认定“现在真能找回”的
// 那一行——见 apps/api/src/services/drive-pages.ts 的 versionToVm：只有未被取代的已采纳交付物那一条
// 会带 restore_href，被取代的历史行早被 acceptedDeliverableVersionMarker 剥掉了。所以这里但凡看到
// restore_href 就能放心接一个真按钮，点了一定打得通，不是猜的假接线。用 <details> 做免 JS 的二次
// 确认——回滚是覆盖性动作，必须先让用户看清楚“会发生什么”再点确定，不能一点就execute。
// 文案按这条 href 背后的真实服务端语义写（work-items.ts 的 restoreAcceptedDeliverable：把当前版本
// 换回上一个已采纳版本，不新建版本行、旧的当前版本也不会被删除），不套用桌面客户端那条“新建版本”
// 的文案——两条路径服务端实现不同，文案不能照抄（详见 reports/r14-drive-rollback-parity.md）。
function driveVersionRestoreHtml(
  version: Pick<DrivePageVM["versions"][number], "restore_href">,
  locale: WorkHubLocale
): string {
  if (!version.restore_href) {
    return "";
  }
  const zh = locale === "zh-CN";
  return `<details class="wh-r4-drive-version-restore" data-r14-drive-version-restore="true">
      <summary class="wh-btn">${escapeHtml(goldPathCopyT(locale, "recoverThisVersion"))}</summary>
      <div class="wh-r4-route-actions">
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "recoveringThisSwitchesTheCurrentVersion"))}</p>
        <a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(version.restore_href))}" data-action-id="drive_restore" data-method="POST">${escapeHtml(goldPathCopyT(locale, "confirmRecovery"))}</a>
      </div>
    </details>`;
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
  const projectTitle = vm.project?.name ?? (goldPathCopyT(locale, "projectDrive"));
  // 网盘是 GitHub 式核心:头部带「← 所有项目」回链 + 当前项目名 + 紧凑项目切换器。
  // 纯增量——既有 data-r4-*/data-r5-* 标记一律保留;无项目/≤1 项目时只渲当前项目名,不出切换器。
  const projectList = projects?.projects ?? [];
  const currentProjectId = vm.project?.id ?? "";
  // M3：当前项目不在清单里时(归档/跨工作区直链)，原生 <select> 会显示第一项名字，与下方标题不符。
  // 补一个 value 为空、选中的「当前项目」占位项，避免错配（选它不导航）。
  const currentInList = projectList.some((project) => project.id === currentProjectId);
  // R5（规模化）：50+ 项目时原生下拉退化为超长滚动列表——只列前 50（清单按最近更新序），
  // 当前项目不在前 50 也保留在顶部，末尾用禁用项告知剩余数量并指去项目页。
  const switcherPool = projectList.slice(0, 50);
  const switcherRest = projectList.length - switcherPool.length;
  const switcherCurrentInPool = switcherPool.some((project) => project.id === currentProjectId);
  const switcherOptions = projectList.length > 1
    ? `${currentInList && switcherCurrentInPool ? "" : `<option value="" selected>${escapeHtml(vm.project?.name ?? "")}</option>`}${switcherPool.map((project) => {
      const selected = project.id === currentProjectId ? " selected" : "";
      // R10（极端数据）：项目名无唯一约束——同名项目在下拉里追加 slug 区分。
      return `<option value="${escapeHtml(safeHref(`/drive?project_id=${encodeURIComponent(project.id)}`))}"${selected}>${escapeHtml(projectList.some((other) => other.id !== project.id && other.name === project.name) ? `${project.name} · ${project.slug}` : project.name)}</option>`;
    }).join("")}${switcherRest > 0 ? `<option value="" disabled>${escapeHtml(locale === "zh-CN" ? `其余 ${switcherRest} 个项目请到「项目」页查找` : `${switcherRest} more — find them on Projects`)}</option>` : ""}`
    : "";
  // R4（规模化）：200 条字母序截断外的文件此前无用户可达出路——补名称搜索框（GET 导航保留项目参数）。
  const driveSearchForm = currentProjectId
    ? `<form class="wh-r4-route-meta" method="get" action="/drive" role="search" data-r9-drive-search-form="true">
        <input type="hidden" name="project_id" value="${escapeHtml(currentProjectId)}" />
        <input class="wh-pill" type="search" name="q" maxlength="120" placeholder="${escapeHtml(goldPathCopyT(locale, "searchFilesByName"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "searchFiles"))}" />
        <button class="wh-btn" type="submit">${escapeHtml(goldPathCopyT(locale, "search"))}</button>
      </form>`
    : "";
  const driveProjectNav = `<nav class="wh-r4-route-meta" data-r8-drive-project-nav="true" data-r8-drive-current-project="${escapeHtml(currentProjectId)}" data-r8-drive-project-count="${escapeHtml(String(projectList.length))}">
        <a class="wh-pill" href="/projects" data-r8-drive-all-projects="true">&#8592; ${escapeHtml(routeT(locale, "drive.allProjects"))}</a>
        <strong data-r8-drive-current-project-name="true">${escapeHtml(vm.project?.name ?? routeT(locale, "drive.kicker"))}</strong>
        ${switcherOptions ? `<select class="wh-pill" data-r8-drive-project-switcher="true" aria-label="${escapeHtml(routeT(locale, "drive.switchProject"))}">${switcherOptions}</select>` : ""}
      </nav>${driveSearchForm}`;
  const selectedActiveItem = vm.items.find((item) => item.id === vm.selected_item_id);
  const selectedDeletedItem = vm.deleted_items.find((item) => item.id === vm.selected_item_id);
  const selectedItem = selectedActiveItem ?? (selectedDeletedItem || vm.requested_item_missing ? undefined : vm.items.find((item) => item.kind === "file") ?? vm.items[0]);
  const requestedMissingNotice = vm.requested_item_missing
    ? `<p class="wh-subtle" data-r9-drive-requested-missing="true">${escapeHtml(routeT(locale, "drive.requestedMissing"))}</p>`
    : "";
  // 普通用户审查 R2：删除按钮的目标曾是服务端挑的「最近手动文件」，与用户当前选中的无关——
  // 选中了可删（手动上传）文件时，删除目标改为选中项；否则维持服务端目标（按钮文案始终带名）。
  const serverDeleteTargetId = vm.actions.delete_item ? driveItemMutationIdFromHref(vm.actions.delete_item.href) : undefined;
  const selectedDeletable = selectedActiveItem?.kind === "file" && selectedActiveItem.delete_href
    ? selectedActiveItem
    : undefined;
  const deleteTargetId = selectedDeletable?.id ?? serverDeleteTargetId;
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
    ? `<select class="wh-pill" data-drive-upload-parent-select="true" aria-label="${escapeHtml(goldPathCopyT(locale, "uploadToFolder"))}"><option value="">${escapeHtml(goldPathCopyT(locale, "driveRoot"))}</option>${uploadFolders.map((folder) => {
      const selected = folder.id === selectedUploadParentId ? " selected" : "";
      return `<option value="${escapeHtml(folder.id)}"${selected}>${escapeHtml(folder.name)}</option>`;
    }).join("")}</select>`
    : "";
  const driveManageActions = [
    vm.actions.upload_file ? `<span class="wh-drive-upload-control" data-drive-upload-control="true"><label class="wh-btn wh-btn-primary wh-drive-upload-label"><span>${escapeHtml(routeT(locale, "drive.upload"))}</span><input class="wh-drive-upload-input" type="file" data-drive-upload-picker="true" data-action-id="drive_upload_file" data-method="POST" data-action-href="${escapeHtml(safeHref(vm.actions.upload_file.href))}" /></label>${uploadParentSelect}</span>` : "",
    vm.actions.delete_item ? `<a class="wh-btn" href="${escapeHtml(safeHref(selectedDeletable?.delete_href ?? vm.actions.delete_item.href))}" data-action-id="drive_delete_item" data-method="POST" data-r5-drive-delete-target="${escapeHtml(deleteTargetId ?? "")}" data-r5-drive-delete-name="${escapeHtml(deleteTarget?.name ?? "")}" data-request-json="${jsonAttr(deletePayload)}">${escapeHtml(deleteLabel)}</a>` : ""
  ].filter(Boolean).join("");
  const fileRows = vm.items.length
    ? vm.items.map((item) => {
      const current = item.current_version;
      const size = current ? formatBytes(current.size_bytes, locale) : "";
      const itemHref = safeHref(`/drive?project_id=${encodeURIComponent(vm.project?.id ?? item.project_id)}&item_id=${encodeURIComponent(item.id)}`);
      const resourceActions = driveResourceActionLinks(item, locale).join("");
      return `<div role="listitem" class="wh-r4-route-row" data-r4-drive-item="${escapeHtml(item.id)}" data-r4-drive-item-kind="${escapeHtml(item.kind)}" data-r4-drive-item-depth="${escapeHtml(String(item.depth))}" data-r4-drive-item-selected="${escapeHtml(String(item.id === selectedItem?.id))}">
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
    ? `<p class="wh-subtle" data-r4-drive-more-files="${escapeHtml(String(driveHiddenFileCount))}">${escapeHtml(routeTf(locale, "drive.filesShown", { shown: driveListedFileCount, total: vm.summary.file_count }))}</p>`
    : "";
  const selectedFileVersions = selectedItem?.kind === "file"
    ? vm.versions.filter((version) => version.item_id === selectedItem.id)
    : vm.versions;
  const driveVersionsHeading = selectedItem?.kind === "file"
    ? `${routeT(locale, "drive.versions")} · ${selectedItem.name}`
    : routeT(locale, "drive.versions");
  const versionRows = selectedFileVersions.length
    ? selectedFileVersions.slice(0, 8).map((version) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-drive-version="${escapeHtml(version.id)}" data-r4-drive-version-current="${escapeHtml(String(version.current))}">
      <div>
        <strong>${escapeHtml(`${version.filename} · v${version.version_no}`)}</strong>
        <p>${escapeHtml(`${formatBytes(version.size_bytes, locale)} · ${formatLocalDate(version.created_at)}`)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveVersionSourceLabel(version.source, locale === "zh-CN"))}</span>
        ${version.current ? `<span class="wh-pill">${escapeHtml(routeT(locale, "drive.current"))}</span>` : ""}
      </div>
      ${driveVersionRestoreHtml(version, locale)}
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.emptyVersions"))}</p>`;
  // R13（残留清理）：版本历史与操作日志是同 VM 的姊妹列表，此前唯独它们没有诚实截断提示。
  const versionsCapNote = selectedFileVersions.length > 8
    ? `<p class="wh-subtle" data-r13-drive-versions-capped="${escapeHtml(String(selectedFileVersions.length - 8))}">${escapeHtml(locale === "zh-CN" ? `只显示最近 8 个版本（共 ${selectedFileVersions.length} 个）。` : `Showing the 8 most recent versions of ${selectedFileVersions.length}.`)}</p>`
    : "";
  // R14（网盘回滚两端对齐，取代 R13 批 P4 的纯提示）：非当前版本里，服务端真给了 restore_href 的
  // 那些已经在上面 driveVersionRestoreHtml 接了真按钮——这里的提示只在“还有非当前版本、但服务端
  // 没给 restore_href”（比如没有关联已采纳交付物的手动上传旧版本）时才出现，如实告知这部分暂时只能
  // 在桌面客户端里找回，而不是笼统地说“网页做不到”。
  const versionsDesktopNotice = selectedFileVersions.some((version) => !version.current && !version.restore_href)
    ? `<p class="wh-subtle" data-r13-drive-versions-desktop-notice="true">${escapeHtml(goldPathCopyT(locale, "recoveringTheseOlderVersionsRequiresThe"))}</p>`
    : "";
  const acceptedRows = vm.accepted_deliverables.length
    ? vm.accepted_deliverables.slice(0, 6).map((accepted) => `<article class="wh-card wh-r4-route-card" data-r4-drive-accepted-deliverable="${escapeHtml(accepted.id)}">
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, accepted.target_kind))}</span>
        <span class="wh-pill">v${escapeHtml(String(accepted.accepted_version))}</span>
      </div>
      <h3 role="heading" aria-level="2">${escapeHtml(accepted.filename ?? accepted.target_path ?? accepted.target_key)}</h3>
      <p>${escapeHtml(accepted.target_path ?? accepted.target_key)}</p>
      <div class="wh-r4-route-meta">
        ${accepted.work_item_id ? `<a class="wh-pill" href="/workitems/${escapeHtml(accepted.work_item_id)}" data-r9-drive-accepted-workitem="${escapeHtml(accepted.work_item_id)}">${escapeHtml(goldPathCopyT(locale, "sourceTask"))}</a>` : ""}
        ${accepted.proposal_id ? `<a class="wh-pill" href="/proposals/${escapeHtml(accepted.proposal_id)}" data-r9-drive-accepted-proposal="${escapeHtml(accepted.proposal_id)}">${escapeHtml(goldPathCopyT(locale, "viewChangeRequest"))}</a>` : ""}
      </div>
      ${driveActionLinks(accepted, locale)}
    </article>`).join("") + (vm.accepted_deliverables.length > 6
      ? `<p class="wh-subtle" data-r11-drive-accepted-overflow="${escapeHtml(String(vm.accepted_deliverables.length - 6))}">${escapeHtml(locale === "zh-CN" ? `只显示最近 6 条已采纳交付物（共 ${vm.accepted_deliverables.length} 条）。` : `Showing the 6 most recent accepted deliverables of ${vm.accepted_deliverables.length}.`)}</p>`
      : "")
    : `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(routeT(locale, "drive.empty"))}</p></article>`;
  const commentRows = vm.comments.length
    ? vm.comments.slice(0, 5).map((comment) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-drive-comment="${escapeHtml(comment.id)}" data-r4-drive-comment-status="${escapeHtml(comment.status)}">
      <div>
        <strong>${escapeHtml(comment.author_label)}</strong>
        <p style="white-space:pre-line">${escapeHtml(comment.body)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveCommentStatusLabel(comment.status, locale))}</span>
        ${comment.draft_action ? `<a class="wh-btn" href="${escapeHtml(safeHref(comment.draft_action.href))}" data-action-id="comment_to_draft" data-method="POST">${escapeHtml(routeT(locale, "drive.createDraft"))}</a>` : ""}
        ${comment.draft_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(comment.draft_href))}">${escapeHtml(routeT(locale, "drive.openDraft"))}</a>` : ""}
        ${comment.proposal_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(comment.proposal_href))}" data-r5-drive-proposal-link="true" data-r5-drive-proposal-id="${escapeHtml(comment.proposal_id ?? "")}" data-r5-drive-proposal-status="${escapeHtml(comment.proposal_status ?? "")}">${escapeHtml(routeT(locale, "drive.openProposal"))}</a>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noCommentsYetLeaveOneAi"))}</p>`;
  // UX-U3（评论闭环缺口）：产品到处承诺「评论生成草稿」，但从没有写评论的入口。补 composer：
  // 发一条评论（pending_llm）→ 列表里出现 →「生成草稿」按既有链路让 AI 接手。
  const commentComposer = currentProjectId
    ? `<form class="wh-r4-approval-comment-form" data-r9-drive-comment-form="${escapeHtml(currentProjectId)}">
        <textarea class="wh-r4-approval-comment-input" data-r9-drive-comment-input rows="2" maxlength="4000" aria-label="${escapeHtml(goldPathCopyT(locale, "commentOnProjectFiles"))}" placeholder="${escapeHtml(goldPathCopyT(locale, "saySomethingAboutTheseFilesE"))}"></textarea>
        <button type="submit" class="wh-btn" data-r9-drive-comment-submit="true">${escapeHtml(goldPathCopyT(locale, "comment"))}</button>
      </form>`
    : "";
  const recycleRows = vm.deleted_items.length
    ? vm.deleted_items.map((item) => `<div role="listitem" class="wh-r4-route-row" data-r5-drive-recycle-item="${escapeHtml(item.id)}" data-r5-drive-recycle-selected="${escapeHtml(String(item.id === selectedDeletedItem?.id))}">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.path)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveItemKindLabel(item.kind, locale === "zh-CN"))}</span>
        ${item.deleted_at ? `<span class="wh-pill">${escapeHtml(formatLocalDate(item.deleted_at))}</span>` : ""}
        ${item.restore_href ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.restore_href))}" data-action-id="drive_restore_item" data-method="POST" data-r5-drive-recycle-restore="${escapeHtml(item.id)}">${escapeHtml(routeT(locale, "drive.restore"))}</a>` : item.restore_blocked_reason ? `<span class="wh-subtle" data-r9-drive-restore-blocked="${escapeHtml(item.id)}">${escapeHtml(locale === "en-US" ? restoreBlockedReasonEn(item.restore_blocked_reason) : item.restore_blocked_reason)}</span>` : ""}
      </div>
    </div>`).join("")
    : "";
  const hiddenRecycleCount = Math.max(0, vm.summary.deleted_item_count - vm.deleted_items.length);
  const recycleMoreNote = hiddenRecycleCount > 0
    ? `<p class="wh-subtle" data-r9-drive-recycle-hidden-count="${escapeHtml(String(hiddenRecycleCount))}" data-r9-drive-recycle-loaded-count="${escapeHtml(String(vm.deleted_items.length))}">${escapeHtml(routeTf(locale, "drive.recycleShown", { shown: vm.deleted_items.length, hidden: hiddenRecycleCount }))}</p>`
    : "";
  const recycleEmpty = vm.deleted_items.length || hiddenRecycleCount > 0
    ? ""
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.emptyRecycle"))}</p>`;
  const operationRows = vm.operations.length
    ? vm.operations.slice(0, 6).map((operation) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-drive-operation="${escapeHtml(operation.id)}" data-r5-drive-operation-type="${escapeHtml(operation.op_type)}">
      <div>
        <strong>${escapeHtml(operation.summary_text)}</strong>
        <p>${escapeHtml(formatLocalDate(operation.created_at))}</p>
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
        <span class="wh-r4-route-count" title="${escapeHtml(goldPathCopyT(locale, "totalFiles"))}">${escapeHtml(`${vm.summary.file_count} ${goldPathCopyT(locale, "files")}`)}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-drive-files="true" data-r4-drive-folder-count="${escapeHtml(String(driveFolderCount))}" data-r4-drive-listed-file-count="${escapeHtml(String(driveListedFileCount))}">
          <h3 role="heading" aria-level="2">${escapeHtml(driveFilesHeading)}</h3>
          <div class="wh-r4-route-timeline" role="list">${fileRows}</div>
          ${driveMoreFilesNote}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-drive-versions="true">
          <h3 role="heading" aria-level="2">${escapeHtml(driveVersionsHeading)}</h3>
          <div class="wh-r4-route-timeline" role="list">${versionRows}${versionsCapNote}</div>
          ${versionsDesktopNotice}
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-drive-accepted="true">
          ${acceptedRows}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-drive-comments="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "drive.comments"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${commentRows}
          ${commentComposer}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r5-drive-recycle="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "drive.recycle"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${recycleRows}${recycleEmpty}</div>
          ${recycleMoreNote}
        </section>
        <section class="wh-card wh-r4-route-card" data-r5-drive-operations="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "drive.operations"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${operationRows}${vm.operations.length > 6 ? `<p class="wh-subtle" data-r13-drive-operations-capped="${escapeHtml(String(vm.operations.length - 6))}">${escapeHtml(locale === "zh-CN" ? `只显示最近 6 条操作（共 ${vm.operations.length} 条）。` : `Showing the 6 most recent operations of ${vm.operations.length}.`)}</p>` : ""}</div>
        </section>
      </div>
    </section>`
  });
}

// L27：转写/纪要为空时不能再共用「这个项目还没有会议洞察」——那是讲洞察、不是讲转写，且会议只是还在
// 处理(processing)/处理失败(failed)时这句是错的。按会议状态给出贴合的占位，让用户分得清「还在生成 / 生成失败 / 真的没有」。
function meetingContentFallback(
  kind: "transcript" | "minutes",
  status: string | undefined,
  locale: WorkHubLocale,
  aiConfigured = true
): string {
  const zh = locale === "zh-CN";
  const noun = kind === "transcript" ? (goldPathCopyT(locale, "transcript")) : (goldPathCopyT(locale, "minutes"));
  // SA-02：转写已入库、纪要还没生成，是两种完全不同的处境——AI 压根没配（等下去也不会有），
  // 和 AI 已排队（等一会就有）。此前两者都掉进「这次会议还没有纪要内容」，用户无从分辨。
  if (kind === "minutes" && status === "transcribed") {
    return routeT(locale, aiConfigured ? "meeting.minutesQueued" : "meeting.minutesNotConfigured");
  }
  if (status === "processing") {
    return zh ? `${noun}还在准备中，稍后回来查看。` : `${noun} is still being prepared — check back shortly.`;
  }
  if (status === "failed") {
    return zh ? `${noun}没有生成成功。` : `${noun} could not be generated.`;
  }
  return zh ? `这次会议还没有${noun}内容。` : `This meeting has no ${kind} yet.`;
}

function renderMeetingRouteComponent(vm: MeetingPageVM, locale: WorkHubLocale, projects?: ProjectListVM | undefined): WebRouteComponent {
  // 普通用户审查：网盘有「← 所有项目 + 切换器」而会议页没有——同款导航（切换导航到 /meetings?project_id=）。
  const projectList = projects?.projects ?? [];
  const currentMeetingProjectId = vm.project?.id ?? "";
  const currentMeetingInList = projectList.some((project) => project.id === currentMeetingProjectId);
  // R5（规模化）：同 drive 切换器——50 上限+剩余数出路。
  const meetingSwitcherPool = projectList.slice(0, 50);
  const meetingSwitcherRest = projectList.length - meetingSwitcherPool.length;
  const meetingCurrentInPool = meetingSwitcherPool.some((project) => project.id === currentMeetingProjectId);
  const meetingSwitcherOptions = projectList.length > 1
    ? `${currentMeetingInList && meetingCurrentInPool ? "" : `<option value="" selected>${escapeHtml(vm.project?.name ?? "")}</option>`}${meetingSwitcherPool.map((project) => {
      const selected = project.id === currentMeetingProjectId ? " selected" : "";
      return `<option value="${escapeHtml(safeHref(`/meetings?project_id=${encodeURIComponent(project.id)}`))}"${selected}>${escapeHtml(projectList.some((other) => other.id !== project.id && other.name === project.name) ? `${project.name} · ${project.slug}` : project.name)}</option>`;
    }).join("")}${meetingSwitcherRest > 0 ? `<option value="" disabled>${escapeHtml(locale === "zh-CN" ? `其余 ${meetingSwitcherRest} 个项目请到「项目」页查找` : `${meetingSwitcherRest} more — find them on Projects`)}</option>` : ""}`
    : "";
  const meetingProjectNav = `<nav class="wh-r4-route-meta" data-r9-meeting-project-nav="true" data-r9-meeting-current-project="${escapeHtml(currentMeetingProjectId)}">
        <a class="wh-pill" href="/projects" data-r9-meeting-all-projects="true">&#8592; ${escapeHtml(routeT(locale, "drive.allProjects"))}</a>
        <strong>${escapeHtml(vm.project?.name ?? "")}</strong>
        ${meetingSwitcherOptions ? `<select class="wh-pill" data-r8-drive-project-switcher="true" aria-label="${escapeHtml(routeT(locale, "drive.switchProject"))}">${meetingSwitcherOptions}</select>` : ""}
      </nav>`;
  const projectTitle = vm.project?.name ?? (goldPathCopyT(locale, "meetingInsights"));
  const selectedMeeting = vm.meetings.find((meeting) => meeting.id === vm.selected_meeting_id) ?? vm.meetings[0];
  const meetingRows = vm.meetings.length
    ? vm.meetings.slice(0, 10).map((meeting) => `<a class="wh-r4-route-row" href="/meetings?project_id=${escapeHtml(meeting.project_id)}&m=${escapeHtml(meeting.id)}" data-r5-meeting-id="${escapeHtml(meeting.id)}" data-r5-meeting-status="${escapeHtml(meeting.status)}" data-r5-meeting-selected="${escapeHtml(String(meeting.id === selectedMeeting?.id))}">
      <div>
        <strong>${escapeHtml(meeting.title)}</strong>
        <p>${personAvatarTileHtml({ userId: meeting.uploaded_by_user_id, label: meeting.uploaded_by_label })}${escapeHtml(`${formatApprovalTimestamp(meeting.created_at)} · ${meeting.uploaded_by_label}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(meetingRecordStatusLabel(meeting.status, locale))}</span>
    </a>`).join("") + (vm.meetings.length > 10
      ? `<p class="wh-subtle" data-r9-meetings-overflow="${escapeHtml(String(vm.meetings.length - 10))}">${escapeHtml(locale === "zh-CN"
        ? `只列出最近 10 场会议（共 ${vm.meetings.length} 场）。`
        : `Showing the 10 most recent meetings of ${vm.meetings.length}.`)}</p>`
      : "")
    // WEB-08：空态合并——没有会议时列表卡内不再重复「还没有会议」文案（此前与头部副标题、底部
    // 引导卡同屏三连）；整页只保留下方 data-r5-meeting-empty 一张有引导的空态卡。
    : (selectedMeeting
      ? `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noInsightsFromThisMeetingYet"))}</p>`
      : "");
  const transcript = selectedMeeting?.transcript_text?.trim() || meetingContentFallback("transcript", selectedMeeting?.status, locale, vm.ai_analysis_configured);
  const minutes = selectedMeeting?.minutes_md?.trim() || meetingContentFallback("minutes", selectedMeeting?.status, locale, vm.ai_analysis_configured);
  const reanalyzeAction = selectedMeeting?.actions?.reanalyze;
  const reanalyzeButton = reanalyzeAction
    ? `<div class="wh-r4-route-actions"><a class="wh-btn" href="${escapeHtml(safeHref(reanalyzeAction.href))}" data-action-id="${escapeHtml(reanalyzeAction.id)}" data-method="${escapeHtml(reanalyzeAction.method)}" data-r23-meeting-reanalyze="${escapeHtml(selectedMeeting?.id ?? "")}">${escapeHtml(reanalyzeAction.label ?? routeT(locale, "meeting.reanalyze"))}</a></div>`
    : "";
  // AI 未配置时页面直说，而不是让人对着「还没有纪要」猜是不是坏了。
  const aiNotConfiguredBanner = vm.ai_analysis_configured
    ? ""
    : `<p class="wh-subtle" data-r23-meeting-ai-unconfigured="true">${escapeHtml(routeT(locale, "meeting.aiNotConfigured"))}</p>`;
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
        <h3 role="heading" aria-level="2">${escapeHtml(insight.title)}</h3>
        <p>${escapeHtml(insight.description)}</p>
        <p>${escapeHtml(routeT(locale, "meeting.reason"))}: ${escapeHtml(insight.confidence_reason)}</p>
        <div class="wh-r4-route-meta">${evidence}</div>
        <div class="wh-r4-route-actions">${createAction}${dismissAction}</div>
      </article>`;
    }).join("")
    : `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(routeT(locale, "meeting.empty"))}</p></article>`;
  const primaryHrefs = [
    ...vm.meetings.flatMap((meeting) => [
      meeting.actions?.reanalyze?.href,
      ...meeting.insights.flatMap((insight) => [
        insight.actions?.create_draft?.href,
        insight.actions?.dismiss?.href,
        insight.draft_href,
        insight.proposal_href
      ])
    ])
  ].filter((value): value is string => Boolean(value));

  return createWebRouteComponent({
    key: "meetings",
    css: webRouteComponentCss,
    primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "meetings",
    html: `<section class="wh-r4-route" data-r4-route-component="meetings" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r5-meetings-route="true" data-r5-meetings-project-id="${escapeHtml(vm.project?.id ?? "")}" data-r5-meeting-selected-id="${escapeHtml(selectedMeeting?.id ?? "")}" data-r5-meeting-count="${escapeHtml(String(vm.summary.meeting_count))}" data-r5-meeting-pending-insights="${escapeHtml(String(vm.summary.pending_insight_count))}" data-r5-meeting-confirmed-insights="${escapeHtml(String(vm.summary.confirmed_insight_count))}" data-r5-meeting-dismissed-insights="${escapeHtml(String(vm.summary.dismissed_insight_count))}" data-r5-meeting-can-manage="${escapeHtml(String(vm.can_manage))}">
      ${meetingProjectNav}
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "meeting.kicker"))}</span>
          <h1>${escapeHtml(projectTitle)}</h1>
          <p>${escapeHtml(selectedMeeting?.title ?? (goldPathCopyT(locale, "meetingTranscriptsMinutesAndInsightsLand")))}</p>
        </div>
        <span class="wh-r4-route-count" title="${escapeHtml(goldPathCopyT(locale, "insightsPendingReview"))}">${escapeHtml(`${vm.summary.pending_insight_count} ${goldPathCopyT(locale, "pending")}`)}</span>
      </header>
      ${aiNotConfiguredBanner}
      ${vm.can_manage && vm.project ? `<details class="wh-card wh-r4-route-card" data-r10-meeting-import="true">
        <summary>${escapeHtml(goldPathCopyT(locale, "importMeetingTranscript"))}</summary>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "pasteMinutesOrATranscriptThe"))}</p>
        <label class="wh-r4-route-stack"><strong>${escapeHtml(goldPathCopyT(locale, "meetingTitle"))}</strong><input class="wh-r4-intake-free-text" style="min-height:auto" type="text" maxlength="256" data-r10-meeting-import-title="true" aria-label="${escapeHtml(goldPathCopyT(locale, "meetingTitle"))}" /></label>
        <label class="wh-r4-route-stack"><strong>${escapeHtml(goldPathCopyT(locale, "transcriptMinutesText"))}</strong><textarea class="wh-r4-intake-free-text" rows="6" maxlength="200000" data-r10-meeting-import-text="true" aria-label="${escapeHtml(goldPathCopyT(locale, "transcriptOrMinutesText"))}"></textarea></label>
        <div class="wh-r4-route-actions"><button type="button" class="wh-btn wh-btn-primary" data-r10-meeting-import-submit="${escapeHtml(vm.project.id)}">${escapeHtml(goldPathCopyT(locale, "import"))}</button></div>
      </details>` : ""}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r5-meeting-list="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "meeting.kicker"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${meetingRows}</div>
        </section>
        ${selectedMeeting ? `<aside class="wh-r4-route-stack" data-r5-meeting-insight-panel="true">
          <section class="wh-card wh-r4-route-card">
            <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "meeting.insights"))}</h3>
            <div class="wh-r4-route-stack">${insightRows}</div>
            <p>${escapeHtml(routeT(locale, "meeting.approvalSafe"))}</p>
          </section>
        </aside>` : ""}
      </div>
      ${selectedMeeting ? `<div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r5-meeting-transcript="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "meeting.transcript"))}</h3>
          <pre class="wh-r5-meeting-text">${escapeHtml(transcript)}</pre>
        </section>
        <section class="wh-card wh-r4-route-card" data-r5-meeting-minutes="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "meeting.minutes"))}</h3>
          <pre class="wh-r5-meeting-text">${escapeHtml(minutes)}</pre>
          ${reanalyzeButton}
        </section>
      </div>` : `<div class="wh-r4-route-grid"><article class="wh-card wh-r4-route-card" data-r5-meeting-empty="true"><h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "meeting.empty"))}</h3><p class="wh-subtle">${escapeHtml(vm.can_manage ? (goldPathCopyT(locale, "onceAMeetingRecordingOrTranscript")) : (goldPathCopyT(locale, "onceATeamMeetingIsBrought")))}</p></article></div>`}
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
  // R15 批 A（A2 提醒阶梯）：next_remind_at 非空 = 这条通知还挂在 24h 叮嘱阶梯上，给一个「暂停提醒」轻链接
  // （POST /api/notifications/:id/snooze 置空 next_remind_at 即抑制，读/归档态不动）。走既有 data-method 动作
  // 管道（apps/web browser.ts 的 notificationActionFromHref → snoozeNotification），成功后整页重渲、按钮自消失。
  const snoozeLink = item.next_remind_at
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(`/api/notifications/${item.id}/snooze`))}" data-action-id="notification_snooze" data-method="POST" data-r15-notification-snooze="true">${escapeHtml(routeT(locale, "notifications.snooze"))}</a>`
    : "";
  const links = [
    item.actions.open ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(item.actions.open.href))}" data-action-id="${escapeHtml(item.actions.open.id)}">${escapeHtml(item.actions.open.label || routeT(locale, "notifications.open"))}</a>` : "",
    item.actions.mark_read ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.actions.mark_read.href))}" data-action-id="${escapeHtml(item.actions.mark_read.id)}" data-method="${escapeHtml(item.actions.mark_read.method)}" data-r5-notification-mark-read="true">${escapeHtml(item.actions.mark_read.label)}</a>` : "",
    snoozeLink,
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
    ? items.map((item) => `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-notification-item="${escapeHtml(item.id)}" data-r5-notification-status="${escapeHtml(item.status)}" data-r5-notification-severity="${escapeHtml(item.severity)}" data-r5-notification-type="${escapeHtml(item.type)}" data-r5-notification-source-type="${escapeHtml(item.source_context?.source_type ?? "")}"${item.conversation_id ? ` data-r14-notification-conversation-id="${escapeHtml(item.conversation_id)}"` : ""}>
      <div>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(notificationStatusLabel(item.status, locale))}</span>
          <span class="wh-pill">${escapeHtml(notificationSeverityLabel(item.severity, locale === "zh-CN"))}</span>
          <span class="wh-pill">${escapeHtml(notificationTypeLabel(item.type, locale === "zh-CN"))}</span>
        </div>
        <strong>${escapeHtml(item.title)}</strong>
        ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
        <p>${escapeHtml(routeT(locale, "notifications.source"))}: ${escapeHtml(sourceContextLabel(item.source_context, locale))}</p>
        ${item.conversation_id ? `<p class="wh-subtle" data-r14-notification-conversation-note="true">${escapeHtml(routeT(locale, "notifications.conversationLinked"))}</p>
        <a class="wh-pill" href="${escapeHtml(safeHref(`/conversations/${encodeURIComponent(item.conversation_id)}`))}" data-r15-notification-conversation-open="true">${escapeHtml(routeT(locale, "notifications.conversationOpen"))}</a>` : ""}
        ${renderNotificationGrounding(item, locale)}
        <p>${escapeHtml(formatApprovalTimestamp(item.created_at))}</p>
      </div>
      ${notificationActionLinks(item, locale)}
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "notifications.empty"))}</p>`;
  return `<section class="wh-card wh-r4-route-card" data-r5-notification-bucket="${escapeHtml(bucket)}" data-r5-notification-bucket-count="${escapeHtml(String(items.length))}">
    <h3 role="heading" aria-level="2">${escapeHtml(notificationBucketTitle(bucket, locale))}</h3>
    <div class="wh-r4-route-timeline" role="list">${rows}</div>
  </section>`;
}

// 团队就绪 must-have（缺口②）：可静音的通知类型清单。每一项的 `type` 必须与后端真正在
// `flushDraft` 里按 `draft.type` 做静音判定的字符串完全一致——否则勾选了却照发就是骗用户。
// 来源：packages/events/src/lifecycle.ts 的 6 个 workitem.* 里程碑 + notifications.ts 的 comment.mention
// + schedule-notify-pages.ts 的 meeting.insight.pending。新增可静音类型时同步这里。
// G4 #23：补 R15 新增的、且经 isMutedForRecipient（createNotification/notifyConversationMessage 内部）
// 真正按 type 静音的类型——三档 DDL 通知（work_item.due_soon/overdue/escalated_ddl，见
// apps/api/src/services/ddl-chase.ts）+ 会话消息/被@（conversation.message/mention，见
// apps/api/src/services/notifications.ts notifyConversationMessage 的 isMutedForRecipient 判定）。
// 刻意不含 work_item.needs_owner：它主通道是项目主区的 action_card（find_owner 决策卡），只有降级
// 回落时才走可静音的通知，勾了未必拦得住主通道——不放进来免得「勾了却照发」。
const MUTABLE_NOTIFICATION_TYPES: ReadonlyArray<{ type: string; zh: string; en: string }> = [
  { type: "workitem.ai_working", zh: "AI 开始处理工作项", en: "AI started working on an item" },
  { type: "workitem.in_review", zh: "工作项待审查", en: "An item is ready for review" },
  { type: "workitem.escalated", zh: "工作项需要负责人介入", en: "An item needs the owner" },
  { type: "workitem.pm_mode", zh: "工作项转 PM 协作模式", en: "An item switched to PM mode" },
  { type: "workitem.merged", zh: "工作项成果已采纳", en: "An item's deliverable was adopted" },
  { type: "workitem.cancelled", zh: "工作项已取消", en: "An item was cancelled" },
  { type: "comment.mention", zh: "评论里 @ 了我", en: "Someone mentioned me in a comment" },
  { type: "meeting.insight.pending", zh: "会议洞察待确认", en: "A meeting insight needs confirmation" },
  { type: "work_item.due_soon", zh: "工作项快到期提醒", en: "An item is due soon" },
  { type: "work_item.overdue", zh: "工作项已逾期提醒", en: "An item is overdue" },
  { type: "work_item.escalated_ddl", zh: "工作项逾期需负责人介入", en: "An overdue item needs the owner" },
  { type: "conversation.message", zh: "会话里的新消息", en: "New messages in a conversation" },
  { type: "conversation.mention", zh: "会话里 @ 了我", en: "Someone mentioned me in a conversation" }
];

// 静音偏好面板：SSR 出一个折叠的 <details>（默认收起→不占版面、不触溢出门），开关默认全不勾（诚实
// default-off）。browser.ts 在通知路由 ready 后拉 GET /api/notifications/preferences 回填勾选态、change 调 PUT。
function renderNotificationMutePanel(locale: WorkHubLocale): string {
  const rows = MUTABLE_NOTIFICATION_TYPES.map(
    (entry) =>
      `<label class="wh-r5-notif-mute-row"><input type="checkbox" data-r5-notification-mute-type="${escapeHtml(entry.type)}" disabled /><span>${escapeHtml(locale === "zh-CN" ? entry.zh : entry.en)}</span></label>`
  ).join("");
  // R10-P1-7：开关 SSR 先禁用——当前偏好是异步 GET 回填的，回填前就能点会让「看起来全不勾」的
  // 假状态被整组 PUT 覆盖掉已有静音。水合成功后由客户端解禁；失败时保持锁定+显式重试。
  const zh = locale === "zh-CN";
  // G4 #10（关怀 opt-out）：关怀私聊开关（默认开）。与「按类型静音」是两回事——这是主动关怀而非
  // 某类通知，故独立成一行、勾选＝开启（不同于下方 mute 行的勾选＝静音）。同样 SSR 先禁用、GET 回填后解禁。
  // 文案避开 web 端不露出的「Cuu」品牌词（smoke 门：web HTML 不含 Cuu；桌面端另有带 Cuu 的措辞）。
  const careToggle = `<label class="wh-r5-notif-mute-row wh-r17-notif-care-row" data-r17-notification-care-row="true"><input type="checkbox" data-r17-notification-care-toggle="true" disabled /><span>${escapeHtml(
    goldPathCopyT(locale, "careCheckIns")
  )}</span></label>
  <p class="wh-subtle wh-r17-notif-care-help">${escapeHtml(
    goldPathCopyT(locale, "youLlGetAPrivateCheck")
  )}</p>`;
  return `<details class="wh-card wh-r4-route-card wh-r5-notif-mute" data-r5-notification-mute-panel="true">
        <summary>${escapeHtml(routeT(locale, "notifications.muteTitle"))}</summary>
        ${careToggle}
        <p class="wh-subtle">${escapeHtml(routeT(locale, "notifications.muteHelp"))}</p>
        <div class="wh-r5-notif-mute-list">${rows}</div>
        <p class="wh-subtle wh-r5-notif-mute-status" data-r5-notification-mute-status="idle" hidden></p>
        <button type="button" class="wh-btn" data-r10-notification-mute-retry="true" hidden>${escapeHtml(goldPathCopyT(locale, "reloadSettings"))}</button>
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
          <h1>${escapeHtml(goldPathCopyT(locale, "donTMissWhatMatters"))}</h1>
          ${vm.capped ? `<p class="wh-subtle" data-r9-notifications-capped="true">${escapeHtml(goldPathCopyT(locale, "showingTheLatest200TheTotals"))}</p>` : ""}
          <p>${escapeHtml(`${notificationBucketTitle("needs_decision", locale)} ${vm.summary.needs_decision_count} · ${notificationBucketTitle("fyi", locale)} ${vm.summary.fyi_count} · ${notificationBucketTitle("done", locale)} ${vm.summary.done_count}`)}</p>
        </div>
        <div class="wh-r4-route-actions">${markAll}</div>
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

// R7（撤销路径）：restore_blocked_reason 服务端为中文人话——en 界面用映射兜底（非点名串，可安全整体映射）。
// C1（R21 审查）：导出给桌面端 apps/desktop-webview/src/workbench/drive/render.ts 复用，
// 避免桌面回收站英文界面直渲后端中文原值。
export function restoreBlockedReasonEn(reason: string): string {
  if (reason.includes("父文件夹")) {
    return "Its parent folder is also in the recycle bin — restore the parent first.";
  }
  if (reason.includes("同名")) {
    return "An active file with the same name exists — rename or remove it first.";
  }
  return "This item cannot be restored right now.";
}

function renderHealthCard(card: ProjectHealthPageVM["cards"][number], locale: WorkHubLocale) {
  const open = card.target_href
    ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(card.target_href))}" data-action-id="health_open_project" data-r5-7-health-open-project="true">${escapeHtml(routeT(locale, "health.openProject"))}</a>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r5-7-health-card="${escapeHtml(card.project_id)}" data-r5-7-health-card-band="${escapeHtml(card.band)}" data-r5-7-health-numbers-visible="${escapeHtml(String(card.numbers_visible))}">
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(healthBandLabel(card.band, locale))}</span>
    </div>
    <h3 role="heading" aria-level="2">${escapeHtml(card.project_name)}</h3>
    <div class="wh-r4-route-meta">${card.signals.map((signal) => renderHealthSignal(signal, card.numbers_visible, locale)).join("")}</div>
    ${open ? `<div class="wh-r4-route-actions">${open}</div>` : ""}
  </section>`;
}

function renderHealthRouteComponent(vm: ProjectHealthPageVM, locale: WorkHubLocale): WebRouteComponent {
  const primaryHrefs = [
    ...vm.cards.map((card) => card.target_href),
    ...vm.cards.flatMap((card) => card.signals.map((signal) => signal.target_href))
  ].filter((value): value is string => Boolean(value));
  // R6（成长阶段）：health 是常驻导航项，Day 1 零项目用户点进来不能只见一句灰字死路——补去项目页的出路。
  const cards = vm.cards.length
    ? vm.cards.map((card) => renderHealthCard(card, locale)).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "health.empty"))}</p>
      <div class="wh-r4-route-actions"><a class="wh-btn wh-btn-primary" href="/projects" data-r9-health-empty-cta="true">${escapeHtml(goldPathCopyT(locale, "openProjects"))}</a></div>`;
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
          <p>${escapeHtml(goldPathCopyT(locale, "oneHealthCardPerProjectScore"))}</p>
        </div>
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
  return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-calendar-block="${escapeHtml(block.id)}" data-r5-calendar-block-kind="${escapeHtml(block.kind)}" data-r5-calendar-block-status="${escapeHtml(block.status)}" data-r5-calendar-block-severity="${escapeHtml(block.severity)}">
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
  // R10-P2-3：路由早就支持 ?date=&view=，页面却没有任何日期/视图控件——用户只能改 URL。
  // 补上一周/今天/下一周 + 日/周切换（纯链接导航，走既有 SPA 管线）。
  const zh = locale === "zh-CN";
  // UI-02：日程锚点按本地零点取日、平移后按本地日期出串——此前按 UTC 零点锚定再切 toISOString，
  // 跨时区/DST 边界会把「上/下一周」算到错误的日期上。
  const anchorDate = vm.scope.date.slice(0, 10);
  const [anchorYear = 1970, anchorMonth = 1, anchorDay = 1] = anchorDate.split("-").map(Number);
  const anchor = new Date(anchorYear, anchorMonth - 1, anchorDay);
  const shiftDays = vm.scope.view === "day" ? 1 : 7;
  const shifted = (days: number) => {
    const next = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + days);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  };
  const calendarHref = (date: string, view: string) => `/calendar?date=${encodeURIComponent(date)}&view=${encodeURIComponent(view)}`;
  const calendarControls = `<div class="wh-r4-route-actions" data-r10-calendar-controls="true">
        <a class="wh-btn" href="${escapeHtml(calendarHref(shifted(-shiftDays), vm.scope.view))}" data-r10-calendar-prev="true">${escapeHtml(zh ? (vm.scope.view === "day" ? "前一天" : "上一周") : (vm.scope.view === "day" ? "Previous day" : "Previous week"))}</a>
        <a class="wh-btn" href="/calendar" data-r10-calendar-today="true">${escapeHtml(goldPathCopyT(locale, "today"))}</a>
        <a class="wh-btn" href="${escapeHtml(calendarHref(shifted(shiftDays), vm.scope.view))}" data-r10-calendar-next="true">${escapeHtml(zh ? (vm.scope.view === "day" ? "后一天" : "下一周") : (vm.scope.view === "day" ? "Next day" : "Next week"))}</a>
        <a class="wh-btn${vm.scope.view === "day" ? " wh-btn-primary" : ""}" href="${escapeHtml(calendarHref(anchorDate, "day"))}" data-r10-calendar-view-day="true" aria-pressed="${escapeHtml(String(vm.scope.view === "day"))}">${escapeHtml(goldPathCopyT(locale, "day"))}</a>
        <a class="wh-btn${vm.scope.view === "day" ? "" : " wh-btn-primary"}" href="${escapeHtml(calendarHref(anchorDate, "week"))}" data-r10-calendar-view-week="true" aria-pressed="${escapeHtml(String(vm.scope.view !== "day"))}">${escapeHtml(goldPathCopyT(locale, "week"))}</a>
      </div>`;
  const dayRows = vm.days.map((day) => `<section class="wh-card wh-r4-route-card" data-r5-calendar-day="${escapeHtml(day.date)}" data-r5-calendar-day-count="${escapeHtml(String(day.blocks.length))}">
    <h3 role="heading" aria-level="2">${escapeHtml(day.date)}</h3>
    <div class="wh-r4-route-timeline" role="list">${day.blocks.length ? day.blocks.map((block) => renderCalendarBlock(block, locale)).join("") : `<p role="listitem" class="wh-subtle">${escapeHtml(routeT(locale, "calendar.empty"))}</p>`}</div>
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
          <h1>${escapeHtml(goldPathCopyT(locale, "whatSComingUp"))}</h1>
          <p>${escapeHtml(`${routeT(locale, "calendar.week")} · ${formatLocalDate(vm.scope.range_start)} - ${formatLocalDate(vm.scope.range_end)}`)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.block_count))}</span>
      </header>
      ${calendarControls}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r5-calendar-upcoming="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "calendar.upcoming"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${vm.blocks.length ? vm.blocks.slice(0, 6).map((block) => renderCalendarBlock(block, locale)).join("") : `<p role="listitem" class="wh-subtle">${escapeHtml(routeT(locale, "calendar.empty"))}</p>`}</div>
        </section>
        <section class="wh-r4-route-stack" data-r5-calendar-days="true">
          ${dayRows}
        </section>
      </div>
    </section>`
  });
}

function costAmount(value: string, locale: WorkHubLocale = "zh-CN") {
  return uiFormatCny(value, locale);
}

function renderBudgetRows(vm: CostDashboardVM, locale: WorkHubLocale) {
  if (vm.budget.length === 0) {
    return `<p role="listitem" class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.emptyBudgets"))}</p>`;
  }
  return vm.budget.slice(0, 5).map((usage, index) => {
    if (usage.enabled === false) {
      return `<div role="listitem" class="wh-r4-route-row" data-r4-cost-budget-row="${escapeHtml(String(index))}" data-r4-cost-budget-status="${escapeHtml(usage.status)}" data-r4-cost-budget-enabled="false">
      <div>
        <strong>${escapeHtml(usage.scope_label)}</strong>
        <p>${escapeHtml(goldPathCopyT(locale, "budgetNotEnabled"))}</p>
      </div>
      <span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "notEnabled"))}</span>
    </div>`;
    }
    const ratio = usage.max_tokens > 0 ? Math.round((usage.total_tokens / usage.max_tokens) * 100) : 0;
    return `<div role="listitem" class="wh-r4-route-row" data-r4-cost-budget-row="${escapeHtml(String(index))}" data-r4-cost-budget-status="${escapeHtml(usage.status)}" data-r4-cost-budget-enabled="true">
      <div>
        <strong>${escapeHtml(usage.scope_label)}</strong>
        <p>${escapeHtml(`${uiFormatCount(usage.total_tokens, locale)}/${uiFormatCount(usage.max_tokens, locale)} tokens · ${costAmount(usage.estimated_cost_cny, locale)}/${costAmount(usage.max_cost_cny, locale)} · ${budgetPeriodLabel(usage.period, locale)}`)}</p>
        <div class="wh-r4-route-meter" aria-hidden="true"><span style="width:${escapeHtml(String(Math.min(100, ratio)))}%"></span></div>
      </div>
      <span class="wh-pill">${escapeHtml(budgetStatusLabel(locale, usage.status))}</span>
    </div>`;
  }).join("");
}

// R10（自解释）：预算行此前完全丢弃 period 字段——用户不知道「本期」是按天/按月/按次统计。
function budgetPeriodLabel(period: string, locale: WorkHubLocale): string {
  return localizedEnumLabel(
    period,
    locale === "zh-CN",
    { run: "按单次运行", day: "按天", month: "按月", total: "累计" },
    { run: "per run", day: "daily", month: "monthly", total: "lifetime" }
  );
}

function agentDashboardStatusLabel(locale: WorkHubLocale, status: string) {
  const labels: Record<string, Record<WorkHubLocale, string>> = {
    pending: { "zh-CN": "待开始", "en-US": "Waiting" },
    dispatched: { "zh-CN": "进行中", "en-US": "In progress" },
    succeeded: { "zh-CN": "已成功", "en-US": "Succeeded" },
    failed: { "zh-CN": "失败", "en-US": "Failed" },
    skipped: { "zh-CN": "已跳过", "en-US": "Skipped" },
    // 普通用户审查（词表统一）：同一状态四处四叫法——needs_human 统一「等你决定/Needs decision」。
    needs_human: { "zh-CN": "等你决定", "en-US": "Needs decision" }
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
    { id: "today_cost", label: routeT(locale, "agents.todayCost"), value: costAmount(vm.kpis.today_cost_cny, locale), note: goldPathCopyT(locale, "visibleTeamsOnly") },
    // 普通用户审查：「自主率」这种词要注明口径（当日 AI 判官复核通过率，无审阅回退 run 成功率）。
    { id: "autonomy_rate", label: routeT(locale, "agents.autonomy"), value: `${vm.kpis.autonomy_rate_pct}%`, note: goldPathCopyT(locale, "todaySAiReviewPassRate") },
    // R13 批 P4（KPI：AI 自动合并数/占比）：与 cost 页 ai_auto_merge 同源同口径；缺省（取数失败/非管理员）
    // 时整张卡不渲染，不冒充 0 次。
    ...(vm.kpis.ai_auto_merge_count !== undefined ? [{
      id: "ai_auto_merge",
      label: goldPathCopyT(locale, "aiAutoMerges"),
      value: locale === "zh-CN" ? `${vm.kpis.ai_auto_merge_count} 次` : `${vm.kpis.ai_auto_merge_count}`,
      ...(vm.kpis.ai_auto_merge_ratio_pct !== undefined
        ? { note: locale === "zh-CN" ? `占今日通过评审的 ${vm.kpis.ai_auto_merge_ratio_pct}%` : `${vm.kpis.ai_auto_merge_ratio_pct}% of today's approvals` }
        : {})
    }] : [])
  ].map((item: { id: string; label: string; value: string; href?: string; note?: string }) => {
    const body = `<strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span>${item.note ? `<span class="wh-subtle" data-r9-agent-kpi-note="true">${escapeHtml(item.note)}</span>` : ""}`;
    return item.href
      ? `<a class="wh-card wh-r4-route-card" data-r9-agent-kpi="${escapeHtml(item.id)}" href="${escapeHtml(safeHref(item.href))}">${body}</a>`
      : `<section class="wh-card wh-r4-route-card" data-r9-agent-kpi="${escapeHtml(item.id)}">${body}</section>`;
  }).join("");
  const sourceWarnings = vm.source_warnings ?? [];
  const warningStrip = sourceWarnings.length
    ? `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r9-agent-source-warnings="${escapeHtml(String(sourceWarnings.length))}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "decisionDataIsPartiallyLoaded"))}</h3>
        <div class="wh-r4-route-timeline" role="list">${sourceWarnings.map((warning) => `<p class="wh-subtle" data-r9-agent-source-warning="${escapeHtml(warning.source)}">${escapeHtml(warning.message)}</p>`).join("")}</div>
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
        <div class="wh-r4-route-timeline" role="list">${capMessages.map((message) => `<p class="wh-subtle">${escapeHtml(message)}</p>`).join("")}</div>
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
        const parsedAt = Date.parse(plan.last_activity_at);
        // R10（极端数据）：未来时间戳（时钟偏移/种子数据）或解析失败——不许钳成「1 分钟前」撒谎。
        if (!Number.isFinite(parsedAt)) {
          return "";
        }
        const ageMs = Date.now() - parsedAt;
        if (ageMs < 0) {
          return `<span class="wh-subtle" data-r9-agent-plan-freshness="true">${escapeHtml(goldPathCopyT(locale, "activeJustNow"))}</span>`;
        }
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
      <div role="listitem" class="wh-r4-route-row">
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
        <span class="wh-subtle">${escapeHtml(`${routeT(locale, "agents.cost")}: ${costAmount(plan.cost.used_cny, locale)}${plan.cost.budget_cny ? `/${costAmount(plan.cost.budget_cny, locale)}` : ""} · ${plan.judge.total > 0 ? `${routeT(locale, "agents.judge")}: ${plan.judge.pass_rate_pct}%` : (goldPathCopyT(locale, "noReviewsYet"))}`)}</span>
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
    ? vm.recent_escalations.map((item) => `<div role="listitem" class="wh-r4-route-row" data-r9-agent-recent-item="${escapeHtml(item.id)}">
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
          <h1>${escapeHtml(goldPathCopyT(locale, "yourAgentTeamsAtWork"))}</h1>
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
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "agents.plans"))}</h3>
          <div class="wh-r4-route-grid">${planCards}</div>
        </section>
        <details class="wh-card wh-r4-route-card" data-r9-agent-recent-activity="accordion" open>
          <summary>${escapeHtml(routeT(locale, "agents.recent"))}</summary>
          <div class="wh-r4-route-timeline" role="list">${recent}</div>
        </details>
      </div>
    </section>`
  });
}

// R23 SA-06：技能页的「AI 自学」状态区块。此前这一页只列已有技能，从不回答「这台部署到底有没有人
// 在攒技能」——而夜间自学 worker 长期默认关着，页面上却一句话都不说，用户只会以为 AI 没本事。
// 三种状态各说各的实话，绝不含糊成一句「运行中」：
//   * 未启用（开关关了 / 没配 LLM 密钥，服务端已合并成一个 enabled=false）；
//   * 正在跑；
//   * 已开启、当前空闲——附上次跑完的时间；本进程启动后还没跑过就照实说，不假装从没自学过。
// 管理员多一个「立即自学一轮」按钮（两段式确认，水合在 apps/web/src/browser.ts）。
function renderTeamSkillsCurationSection(vm: TeamSkillsPageVM, locale: WorkHubLocale, isAdmin: boolean): string {
  // 契约上 curation 必填；但渲染层面对「还没升级到这版契约的服务端 / 旧夹具」时不能整页炸成错误卡——
  // 没有这段信息就不渲这一节（诚实缺省），而不是猜一个「未开启」。
  const curation = (vm as Partial<TeamSkillsPageVM>).curation;
  if (!curation) {
    return "";
  }
  const statusText = !curation.enabled
    ? routeT(locale, "skills.curationOffSetting")
    : curation.running
      ? routeT(locale, "skills.curationRunning")
      : routeT(locale, "skills.curationIdle");
  const lastRun = curation.last_run_at
    ? `<span class="wh-pill" data-r23-skills-curation-last-run="${escapeHtml(curation.last_run_at)}">${escapeHtml(`${routeT(locale, "skills.curationLastRun")} ${formatLocalTimestamp(curation.last_run_at)}`)}</span>`
    : `<span class="wh-subtle" data-r23-skills-curation-never="true">${escapeHtml(routeT(locale, "skills.curationNeverRun"))}</span>`;
  // 按钮只在「管理员 + 已启用 + 当前没在跑」时出现——渲一个必然被服务端 403/409 打回的按钮就是假入口。
  // 服务端仍然独立判定（不信前端），这里只是不给用户送一次注定失败的点击。
  const action = isAdmin && curation.enabled && !curation.running
    ? `<button type="button" class="wh-btn" data-r23-skills-curate-now="true" data-r23-skills-curate-confirm-label="${escapeHtml(routeT(locale, "skills.curateNowConfirm"))}">${escapeHtml(routeT(locale, "skills.curateNow"))}</button>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r23-skills-curation="${escapeHtml(curation.enabled ? (curation.running ? "running" : "idle") : "disabled")}">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "skills.curationTitle"))}</h3>
          <p class="wh-subtle" data-r23-skills-curation-status="true">${escapeHtml(statusText)}</p>
          <div class="wh-r4-route-meta">${lastRun}</div>
          ${action}
          <p class="wh-subtle" data-r23-skills-curate-notice="true" hidden></p>
        </section>`;
}

function renderTeamSkillsRouteComponent(vm: TeamSkillsPageVM, locale: WorkHubLocale, isAdmin = false): WebRouteComponent {
  const cards = vm.skills.length
    ? vm.skills.map((skill) => {
        const badges = [
          `<span class="wh-pill">${escapeHtml(`${routeT(locale, "skills.version")} v${skill.version}`)}</span>`,
          skill.created_by_kind === "ai"
            ? `<span class="wh-pill">${escapeHtml(routeT(locale, "skills.aiAuthored"))}</span>`
            : "",
          skill.confidence_score !== undefined
            ? `<span class="wh-pill" title="${escapeHtml(locale === "zh-CN" ? `基于 ${skill.sample_count} 次实际使用的采纳/复核通过情况估算——分数越高越可放心直接复用。` : `Estimated from ${skill.sample_count} real uses (adoption / review pass rate) — higher means safer to reuse as-is.`)}" data-r10-skill-readiness="${escapeHtml(String(skill.confidence_score))}">${escapeHtml(`${routeT(locale, "skills.readiness")} ${Math.round(skill.confidence_score * 100)}%`)}</span>`
            : "",
          skill.provenance
            ? `<span class="wh-pill wh-pill--accent" data-r8-skill-refined="true" data-r8-skill-refined-ops="${escapeHtml(String(skill.provenance.op_count))}">${escapeHtml(`${routeT(locale, "skills.refinedFrom")}${skill.provenance.refined_from_version} · ${locale === "zh-CN" ? `改了 ${skill.provenance.op_count} 处` : `${skill.provenance.op_count} ${skill.provenance.op_count === 1 ? "edit" : "edits"}`}`)}</span>`
            : ""
        ].filter(Boolean).join("");
        // A2-93：rationale_md 是 AI 精修补丁时写给自己的理由（模型自述），不是用户要读的内容。
        // 「已精修 · 改了 N 处」这条徽章已经把用户需要知道的说完了。
        const rationale = "";
        return `<section class="wh-card wh-r4-route-card" data-r8-skill="${escapeHtml(skill.skill_key)}" data-r8-skill-version="${escapeHtml(String(skill.version))}">
          <h3 role="heading" aria-level="2">${escapeHtml(skill.name)}</h3>
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
      ${renderTeamSkillsCurationSection(vm, locale, isAdmin)}
      <div class="wh-r4-route-grid">${cards}</div>
    </section>`
  });
}

// R14 批 MEM（记忆可见可治理）：出处三级降级已由服务端拼好 provenance.label（见 03-mem-design §2.3）；
// 前端只在完全没有 provenance 时兜底显示「早期记录，出处不明」，绝不留空白或显示 null 字样。
function memoryProvenanceLabel(item: UserMemoryManagementItemVM, locale: WorkHubLocale): string {
  return item.provenance?.label ?? routeT(locale, "memory.provenanceUnknown");
}

function memoryCategoryLabel(category: UserMemoryManagementItemVM["category"], locale: WorkHubLocale): string {
  const key = `memory.category.${category}` as RouteCopyKey;
  return routeT(locale, key);
}

function renderMemoryProfileItem(item: UserMemoryManagementItemVM, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const editedLine = item.edited_at
    ? `<p class="wh-subtle" data-r14-mem-edited="true">${escapeHtml(zh ? `最近由你于 ${formatLocalDate(item.edited_at)} 修改` : `Last edited by you on ${formatLocalDate(item.edited_at)}`)}</p>`
    : "";
  return `<article class="wh-card wh-r4-route-card" data-r14-mem-item="${escapeHtml(item.id)}" data-r14-mem-updated-at="${escapeHtml(item.updated_at)}">
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(memoryCategoryLabel(item.category, locale))}</span>
      ${item.workspace_scoped ? "" : `<span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "global"))}</span>`}
    </div>
    <p data-r14-mem-value-view="true">${escapeHtml(item.value_md)}</p>
    <textarea class="wh-r14-mem-textarea" data-r14-mem-value-input maxlength="2000" hidden>${escapeHtml(item.value_md)}</textarea>
    <p class="wh-subtle" data-r14-mem-provenance="true">${escapeHtml(memoryProvenanceLabel(item, locale))}</p>
    ${editedLine}
    <p class="wh-subtle" data-r14-mem-status="true" hidden></p>
    <p class="wh-subtle" data-r14-mem-delete-hint="true" hidden>${escapeHtml(routeT(locale, "memory.deleteHint"))}</p>
    <div class="wh-r4-route-actions">
      <button type="button" class="wh-btn" data-r14-mem-edit-btn="true" data-r14-mem-id="${escapeHtml(item.id)}">${escapeHtml(routeT(locale, "memory.edit"))}</button>
      <button type="button" class="wh-btn wh-btn-primary" data-r14-mem-save-btn="true" hidden>${escapeHtml(routeT(locale, "memory.save"))}</button>
      <button type="button" class="wh-btn" data-r14-mem-cancel-btn="true" hidden>${escapeHtml(routeT(locale, "memory.cancel"))}</button>
      <button type="button" class="wh-btn wh-btn-danger" data-r14-mem-delete-btn="true" data-r14-mem-id="${escapeHtml(item.id)}">${escapeHtml(routeT(locale, "memory.delete"))}</button>
    </div>
  </article>`;
}

function renderMemoryProfilePanel(vm: UserMemoryManagementPageVM, locale: WorkHubLocale, active: boolean): string {
  const items = vm.memories.length
    ? vm.memories.map((item) => renderMemoryProfileItem(item, locale)).join("")
    : `<p class="wh-subtle" data-r14-mem-profile-empty="true">${escapeHtml(routeT(locale, "memory.profileEmpty"))}</p>`;
  return `<section class="wh-r14-mem-panel" role="tabpanel" id="wh-r14-mem-panel-profile" aria-labelledby="wh-r14-mem-tab-profile" data-r14-mem-profile-panel="true" data-r14-mem-active-count="${escapeHtml(String(vm.totals.active))}" ${active ? "" : "hidden"}>
    <div class="wh-r4-route-grid">${items}</div>
  </section>`;
}

// K2 段落级受限编辑补丁（最多 TEAM_SKILL_MAX_EDIT_OPS=3 个 op）的最简 UI：一个可见 op 行 + 「加一处修改」
// 按钮逐步露出第 2/3 行——不强套复杂 diff 编辑器，普通管理员日常只改一段的场景一步到位。
function renderMemorySkillOpRow(index: number, locale: WorkHubLocale, visible: boolean): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-r14-mem-op-row" data-r14-skill-op-row="${index}" ${visible ? "" : "hidden"}>
    <select data-r14-skill-op-type aria-label="${escapeHtml(goldPathCopyT(locale, "operation"))}">
      <option value="">${escapeHtml(goldPathCopyT(locale, "leaveUnchanged"))}</option>
      <option value="add_section">${escapeHtml(goldPathCopyT(locale, "addSection"))}</option>
      <option value="modify_section">${escapeHtml(goldPathCopyT(locale, "modifySection"))}</option>
      <option value="remove_section">${escapeHtml(goldPathCopyT(locale, "removeSection"))}</option>
    </select>
    <input type="text" data-r14-skill-op-section maxlength="80" placeholder="${escapeHtml(goldPathCopyT(locale, "sectionTitleEGEdgeCases"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "sectionTitle"))}" />
    <textarea class="wh-r14-mem-textarea" data-r14-skill-op-content maxlength="4000" placeholder="${escapeHtml(goldPathCopyT(locale, "sectionBodyRequiredForAddModify"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "sectionBody"))}"></textarea>
  </div>`;
}

function renderMemorySkillItem(item: TeamSkillManagementItemVM, locale: WorkHubLocale, isAdmin: boolean): string {
  const zh = locale === "zh-CN";
  const statusKey = `memory.status.${item.status}` as RouteCopyKey;
  const badges = [
    `<span class="wh-pill">${escapeHtml(`${routeT(locale, "skills.version")} v${item.version}`)}</span>`,
    `<span class="wh-pill" data-r14-skill-status="${escapeHtml(item.status)}">${escapeHtml(routeT(locale, statusKey))}</span>`,
    item.created_by_kind === "ai"
      ? `<span class="wh-pill">${escapeHtml(routeT(locale, "skills.aiAuthored"))}</span>`
      : `<span class="wh-pill">${escapeHtml(routeT(locale, "memory.humanEdited"))}</span>`,
    item.provenance
      ? `<span class="wh-pill wh-pill--accent">${escapeHtml(`${routeT(locale, "skills.refinedFrom")}${item.provenance.refined_from_version}`)}</span>`
      : ""
  ].filter(Boolean).join("");
  const deprecatedLine = item.status === "deprecated" && item.deprecated_reason
    ? `<p class="wh-subtle" data-r14-skill-deprecated-reason="true">${escapeHtml(item.deprecated_reason)}</p>`
    : "";
  // 编辑/停用仅对当前激活版本、且仅管理员开放（服务端 §3.2 同款门槛；isAdmin 在 SSR 阶段已从
  // shellUser 拿到，此处直接按条件渲染，不做「先渲后隐藏」的闪烁写法）。
  const adminActions = isAdmin && item.status === "active"
    ? `<div class="wh-r4-route-actions">
        <button type="button" class="wh-btn" data-r14-skill-edit-btn="true" data-r14-skill-id="${escapeHtml(item.id)}">${escapeHtml(routeT(locale, "memory.edit"))}</button>
        <button type="button" class="wh-btn wh-btn-danger" data-r14-skill-deactivate-btn="true" data-r14-skill-id="${escapeHtml(item.id)}">${escapeHtml(routeT(locale, "memory.deactivate"))}</button>
      </div>
      <p class="wh-subtle" data-r14-skill-status-line="true" hidden></p>
      <div data-r14-skill-edit-form="true" data-r14-skill-id="${escapeHtml(item.id)}" data-r14-skill-base-version="${escapeHtml(String(item.version))}" hidden>
        ${renderMemorySkillOpRow(0, locale, true)}
        ${renderMemorySkillOpRow(1, locale, false)}
        ${renderMemorySkillOpRow(2, locale, false)}
        <button type="button" class="wh-btn" data-r14-skill-add-op-btn="true">${escapeHtml(goldPathCopyT(locale, "addAnotherEdit"))}</button>
        <textarea class="wh-r14-mem-textarea" data-r14-skill-rationale maxlength="2000" placeholder="${escapeHtml(goldPathCopyT(locale, "whyThisChangeOptional"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "rationale"))}"></textarea>
        <div class="wh-r4-route-actions">
          <button type="button" class="wh-btn wh-btn-primary" data-r14-skill-submit-btn="true">${escapeHtml(routeT(locale, "memory.save"))}</button>
          <button type="button" class="wh-btn" data-r14-skill-edit-cancel-btn="true">${escapeHtml(routeT(locale, "memory.cancel"))}</button>
        </div>
        <p class="wh-subtle" data-r14-skill-edit-status="true" hidden></p>
      </div>
      <div data-r14-skill-deactivate-form="true" data-r14-skill-id="${escapeHtml(item.id)}" hidden>
        <input type="text" data-r14-skill-deactivate-reason maxlength="500" placeholder="${escapeHtml(routeT(locale, "memory.reasonPlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "memory.reasonPlaceholder"))}" />
      </div>`
    : "";
  return `<article class="wh-card wh-r4-route-card" data-r14-skill-item="${escapeHtml(item.id)}" data-r14-skill-key="${escapeHtml(item.skill_key)}" data-r14-skill-version="${escapeHtml(String(item.version))}">
    <h3 role="heading" aria-level="2">${escapeHtml(item.name)}</h3>
    <p>${escapeHtml(item.when_to_use)}</p>
    <div class="wh-r4-route-meta">${badges}</div>
    ${deprecatedLine}
    ${adminActions}
  </article>`;
}

function renderMemorySkillsPanel(vm: TeamSkillManagementPageVM, locale: WorkHubLocale, isAdmin: boolean, active: boolean): string {
  const items = vm.skills.length
    ? vm.skills.map((item) => renderMemorySkillItem(item, locale, isAdmin)).join("")
    : `<p class="wh-subtle" data-r14-mem-skills-empty="true">${escapeHtml(routeT(locale, "memory.skillsEmpty"))}</p>`;
  const adminNote = isAdmin ? "" : `<p class="wh-subtle" data-r14-mem-admin-note="true">${escapeHtml(routeT(locale, "memory.adminOnlyNote"))}</p>`;
  return `<section class="wh-r14-mem-panel" role="tabpanel" id="wh-r14-mem-panel-skills" aria-labelledby="wh-r14-mem-tab-skills" data-r14-mem-skills-panel="true" ${active ? "" : "hidden"}>
    ${adminNote}
    <div class="wh-r4-route-grid">${items}</div>
  </section>`;
}

function renderMemoryRouteComponent(
  input: { userMemories: UserMemoryManagementPageVM; teamSkills: TeamSkillManagementPageVM; tab: "profile" | "skills"; isAdmin: boolean },
  locale: WorkHubLocale
): WebRouteComponent {
  const activeTab = input.tab === "skills" ? "skills" : "profile";
  const tabHref = (tab: "profile" | "skills") => `/settings/memory${tab === "profile" ? "" : `?tab=${tab}`}`;
  return createWebRouteComponent({
    key: "memory",
    css: webRouteComponentCss,
    primaryHrefs: [],
    source: "page-vm",
    locale,
    pageVm: "memory",
    html: `<section class="wh-r4-route" data-r4-route-component="memory" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r14-mem-active-tab="${escapeHtml(activeTab)}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "memory.kicker"))}</span>
          <h1>${escapeHtml(routeT(locale, "memory.title"))}</h1>
          <p>${escapeHtml(routeT(locale, "memory.summary"))}</p>
        </div>
      </header>
      <nav class="wh-r14-mem-tabs" role="tablist" aria-label="${escapeHtml(routeT(locale, "memory.title"))}">
        <a role="tab" id="wh-r14-mem-tab-profile" class="wh-r14-mem-tab" href="${escapeHtml(tabHref("profile"))}" data-wh-route="${escapeHtml(tabHref("profile"))}" data-r14-mem-tab="profile" aria-selected="${escapeHtml(String(activeTab === "profile"))}" aria-controls="wh-r14-mem-panel-profile">${escapeHtml(routeT(locale, "memory.tabProfile"))}</a>
        <a role="tab" id="wh-r14-mem-tab-skills" class="wh-r14-mem-tab" href="${escapeHtml(tabHref("skills"))}" data-wh-route="${escapeHtml(tabHref("skills"))}" data-r14-mem-tab="skills" aria-selected="${escapeHtml(String(activeTab === "skills"))}" aria-controls="wh-r14-mem-panel-skills">${escapeHtml(routeT(locale, "memory.tabSkills"))}</a>
      </nav>
      ${renderMemoryProfilePanel(input.userMemories, locale, activeTab === "profile")}
      ${renderMemorySkillsPanel(input.teamSkills, locale, input.isAdmin, activeTab === "skills")}
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
      const updatedLabel = `${routeT(locale, "projects.updated")} ${formatLocalDate(project.updated_at)}`;
      const projectHref = `/projects/${encodeURIComponent(project.id)}`;
      return `<div role="listitem" class="wh-r4-route-row" data-r8-project="${escapeHtml(project.id)}" data-r8-project-slug="${escapeHtml(project.slug)}" data-r8-project-archived="${escapeHtml(String(project.archived))}" data-r8-project-open-items="${escapeHtml(String(project.open_work_item_count))}">
      <div>
        <strong><a class="wh-r4-route-row-title" href="${escapeHtml(safeHref(projectHref))}">${escapeHtml(project.name)}</a></strong>
        ${descriptionLine}
        <div class="wh-r4-route-meta">
          ${project.owner_user_id ? personAvatarTileHtml({ userId: project.owner_user_id, label: project.owner_nickname }) : ""}<span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.owner")} · ${project.owner_nickname}`)}</span>
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
        ${projects.length > 5 ? `<input class="wh-pill" type="search" data-r12-project-filter="true" maxlength="120" placeholder="${escapeHtml(goldPathCopyT(locale, "filterByName"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "filterProjects"))}" />` : ""}
        <div class="wh-r4-route-timeline" role="list">${rows}</div>
      </section>
    </section>`
  });
}

// R14 批 GH（07-gh-design.md §5.1）：项目主页 github_activities 区块——GH-B 已把它接进
// ProjectHomePageVM（扁平数组，非富对象；绑定/同步元信息走独立的绑定卡端点，桌面端设置里的绑定卡消费）。
// 无绑定/绑定但暂无活动/取数失败三种情况服务端都省略这个字段，故这里只需判空即可诚实不渲区块。
function githubActivityKindLabel(kind: GithubActivityVM["kind"], zh: boolean): string {
  switch (kind) {
    case "commit":
      return goldPathCopyT(zh, "commit");
    case "pull_request":
      return "PR";
    case "issue":
      return goldPathCopyT(zh, "issue");
    default:
      return kind;
  }
}

// web 是真浏览器（不是桌面 Tauri webview），target=_blank 真能把外链甩到系统浏览器，
// 照抄网盘下载链接的既有外链手法（data-native-resource-link + rel=noreferrer）。
function githubActivityRowHtml(item: GithubActivityVM, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const stateTag = item.state ? `<span class="wh-pill" data-tone="${escapeHtml(item.state)}">${escapeHtml(item.state)}</span>` : "";
  const authorTag = item.author_login ? `<span class="wh-pill">${escapeHtml(item.author_login)}</span>` : "";
  return `<a class="wh-r4-route-row" href="${escapeHtml(safeHref(item.html_url))}" data-r14-project-home-github-item="true" data-native-resource-link="true" target="_blank" rel="noreferrer">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(githubActivityKindLabel(item.kind, zh))}</span>
          ${stateTag}
          ${authorTag}
          <span class="wh-pill">${escapeHtml(formatLocalDate(item.occurred_at))}</span>
        </div>
      </div>
    </a>`;
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
    ? `${routeT(locale, "projects.openItems")} ${totalOpen} · ${goldPathCopyT(locale, "youCanHandle")} ${viewableOpen}`
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
        parts.push(routeTf(locale, "projectHome.handleableSummary", { shown: shownOpen, total: viewableOpen }));
      } else {
        parts.push(goldPathCopyT(locale, "noOpenItemsAreCurrentlyIn"));
      }
      if (collapsedOpenCount > 0) {
        parts.push(routeTf(locale, "projectHome.collapsedSummary", { count: collapsedOpenCount }));
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
        <span class="wh-pill">${escapeHtml(formatLocalDate(file.updated_at))}</span>
        <span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "viewInDrive"))}</span>
      </div>
    </a>`).join("")
    : `<p class="wh-subtle" data-r8-project-home-no-files="true">${escapeHtml(routeT(locale, "projectHome.noFiles"))}</p>`;
  // R14 批 GH：未绑定/绑定但暂无活动/取数失败——服务端三种情况都省略这个字段（诚实缺省），无法
  // 区分三者。G-web 止血批：此前空值直接不渲区块，用户看不到任何引导，误以为项目主页就是没有
  // 这块能力；改为区块常渲，空值时给一条空态提示——GitHub 绑定只在桌面客户端项目设置里做。
  const githubActivities = vm.github_activities ?? [];
  const githubBody = githubActivities.length
    ? `<div class="wh-r4-route-table">${githubActivities.map((item) => githubActivityRowHtml(item, locale)).join("")}</div>`
    : `<p class="wh-subtle" data-r14-project-home-github-empty="true">${escapeHtml(routeT(locale, "projectHome.githubEmpty"))}</p>`;
  const githubSection = `<section class="wh-card wh-r4-route-card" data-r14-project-home-github="${escapeHtml(String(githubActivities.length))}">
        <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "projectHome.github"))}</h3>
        ${githubBody}
      </section>`;
  // G4 #9（E3 web 只读入口）：规划草案小区块——SSR 出骨架，browser.ts 拉 GET /api/projects/:id/plan-drafts
  // 后填 pending_review 计数 + 最新草案状态（只读；起草/审批/物化都在桌面客户端）。取数失败/无权静默降级。
  const plansSection = `<section class="wh-card wh-r4-route-card" data-r17-project-home-plans="true" data-r17-project-home-plans-project="${escapeHtml(project.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "planDrafts"))}</h3>
        <div data-r17-project-home-plans-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingPlanDrafts"))}</p></div>
      </section>`;
  // G4 #24（项目自定义指令 web 入口）：SSR 出骨架，browser.ts 拉 GET /api/projects/:id/instructions
  // 后按权限渲可编辑 textarea（失焦 PATCH 保存）或只读说明（403）。与桌面 W4b1 同一错误矩阵。
  // R18 批 H1（项目设置成员分区镜像）：项目主页（管理者视角）「成员」摘要小块——SSR 出骨架，browser.ts
  // bindProjectHomeMembersPanel 拉 /api/users（主区全员计数）与 /api/projects/:id/conversations（协同
  // 会话数 + 主区会话 id）后填数并链到主区会话镜像。轻量镜像，不复制桌面工作台的成员全功能。
  const membersSection = `<section class="wh-card wh-r4-route-card" data-r18-project-home-members="true" data-r18-project-home-members-project="${escapeHtml(project.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "members"))}</h3>
        <div data-r18-project-home-members-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingMemberSummary"))}</p></div>
      </section>`;
  // R20 wave4（R19-1 OKR 前端接线）→ R23 F-01（OKR 列表/详情持久化）：服务端 POST /api/objectives
  // （建目标+关键结果）与 POST /api/objectives/:id/link（挂工作项）此前没有前端入口；列表也一度只是
  // 会话内内存态。目标是工作区级实体（objectives 表没有 project_id 列），不是「这个项目的目标」——
  // 文案刻意不说「项目目标」。服务端现已提供 GET /api/projects/:id/objectives（该项目所在工作区的全部
  // 目标，仍不做项目级过滤）与 GET /api/objectives/:id（详情），browser.ts 的
  // bindProjectHomeObjectivesPanel 挂载后真拉取——这里只出 SSR 加载骨架（同 plansSection/
  // membersSection 的既有先例：GET 数据永不在 SSR 内嵌，一律客户端水合），不再假装「服务端没有列表
  // 端点」。
  const objectivesSection = `<section class="wh-card wh-r4-route-card" data-r20-project-home-objectives="true" data-r20-project-home-objectives-project="${escapeHtml(project.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "okrObjectivesKeyResults"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "objectivesAreWorkspaceWideNotScoped"))}</p>
        <form data-r20-okr-create-form="true">
          <div class="wh-r4-route-row">
            <input type="text" class="wh-pill" data-r20-okr-title-input maxlength="256" placeholder="${escapeHtml(goldPathCopyT(locale, "objectiveTitle"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "objectiveTitle"))}" />
          </div>
          <div class="wh-r4-route-row">
            <textarea class="wh-pill" style="width:100%;box-sizing:border-box;resize:vertical" data-r20-okr-description-input maxlength="4000" rows="2" placeholder="${escapeHtml(goldPathCopyT(locale, "descriptionOptional"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "description"))}"></textarea>
          </div>
          <div class="wh-r4-route-row">
            <textarea class="wh-pill" style="width:100%;box-sizing:border-box;resize:vertical" data-r20-okr-kr-input maxlength="2000" rows="3" placeholder="${escapeHtml(goldPathCopyT(locale, "keyResultsOnePerLineOptional"))}" aria-label="${escapeHtml(goldPathCopyT(locale, "keyResults"))}"></textarea>
          </div>
          <p class="wh-subtle" data-r20-okr-create-status hidden></p>
          <button type="submit" class="wh-btn wh-btn-primary" data-r20-okr-create-submit="true">${escapeHtml(goldPathCopyT(locale, "createObjective"))}</button>
        </form>
        <div data-r20-okr-list role="list">
          <p class="wh-subtle" data-r20-okr-list-loading="true">${escapeHtml(goldPathCopyT(locale, "loadingObjectives"))}</p>
        </div>
      </section>`;
  // R23 P4（R20 P2A 端点上界面）：项目生命周期分区——归档 / 删除。POST /api/projects/:id/{archive,delete}
  // 服务端早已齐备（project-ops.ts），此前 web 只有一枚「已归档」徽标、没有任何动作入口。资格由 VM 的
  // can_manage_lifecycle 下发（服务端用与写端点同一个谓词算），没资格整块不渲——不给会 403 的假入口。
  // 两个动作都是破坏性的，走 apps/web 既有的两段式确认（armConfirmButton），第一次点只是换文案。
  const lifecycleSection = vm.can_manage_lifecycle === true
    ? `<section class="wh-card wh-r4-route-card" data-r23-project-lifecycle="true" data-r23-project-lifecycle-project="${escapeHtml(project.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "projectLifecycle"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "archivingTucksTheProjectOutOf"))}</p>
        <div class="wh-r4-route-actions">
          <button type="button" class="wh-btn" data-r23-project-archive="true">${escapeHtml(goldPathCopyT(locale, "archiveProject"))}</button>
          <button type="button" class="wh-btn" data-r23-project-delete="true">${escapeHtml(goldPathCopyT(locale, "deleteProject"))}</button>
        </div>
        <p class="wh-subtle" data-r23-project-lifecycle-status="true" hidden></p>
      </section>`
    : "";
  const instructionsSection = `<section class="wh-card wh-r4-route-card" data-r17-project-home-instructions="true" data-r17-project-home-instructions-project="${escapeHtml(project.id)}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "customInstructions"))}</h3>
        <p class="wh-subtle">${escapeHtml(
          goldPathCopyT(locale, "everyAiConversationAndAutomatedRun")
        )}</p>
        <div data-r17-project-home-instructions-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingCustomInstructions"))}</p></div>
      </section>`;
  const rows = vm.open_work_items.length
    ? vm.open_work_items.map((item) => `<a class="wh-r4-route-row" href="${escapeHtml(safeHref(item.href))}" data-r8-project-home-item="${escapeHtml(item.id)}" data-r8-project-home-item-code="${escapeHtml(item.code)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(item.code)}</span>
          <span class="wh-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(workItemStatusLabel(locale, item.status))}</span>
          <span class="wh-pill">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span>
          ${item.army ? `<span class="wh-pill" data-r9-project-army-pill="${escapeHtml(item.id)}" title="${escapeHtml(goldPathCopyT(locale, "agentTeamSubtasksDone"))}">${escapeHtml(routeTf(locale, "projectHome.armyPill", { done: item.army.done, total: item.army.total }))}</span>` : ""}
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
          <a class="wh-btn" href="/projects/${escapeHtml(project.id)}/timeline" data-r15-project-home-timeline="true">${escapeHtml(goldPathCopyT(locale, "timeline"))}</a>
        </div>
      </header>
      <section class="wh-card wh-r4-route-card" data-r8-project-home-list="true">
        <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "projectHome.openWork"))}</h3>
        <div class="wh-r4-route-table">${rows}</div>
        ${moreNote}
      </section>
      <section class="wh-card wh-r4-route-card" data-r8-project-home-files="${escapeHtml(String(vm.drive.file_count))}">
        <h3 role="heading" aria-level="2">${escapeHtml(fileCountLabel)}</h3>
        <div class="wh-r4-route-table">${fileRows}</div>
        ${filesMoreNote}
        <a class="wh-r4-route-kicker" href="${escapeHtml(safeHref(vm.actions.open_drive.href))}" data-r8-project-home-files-all="true">${escapeHtml(vm.actions.open_drive.label)} →</a>
      </section>
      ${githubSection}
      ${plansSection}
      ${objectivesSection}
      ${membersSection}
      ${instructionsSection}
      ${lifecycleSection}
      <a class="wh-r4-route-kicker" href="/projects" data-r8-project-home-back="true">${escapeHtml(routeT(locale, "projectHome.back"))}</a>
    </section>`
  });
}

// R15 批 E2c：web 端只读时间线（/projects/:id/timeline）。web 是管理者控制台定位——不画甘特条，
// 按里程碑分组的列表式表格读得清即可（due / 逾期 / 阻塞 N / 依赖 #CODE / OKR 标注）。纯只读，无写控件
// （里程碑 CRUD/挂依赖是桌面工作台的地盘，web 不给假点击）。CJK 溢出门：不用定高 line-clamp，标题正常换行。
function renderProjectTimelineRouteComponent(vm: ProjectTimelinePageVM, locale: WorkHubLocale): WebRouteComponent {
  const zh = locale === "zh-CN";
  const codeById = new Map(vm.items.map((item) => [item.id, item.code]));

  const rowHtml = (item: TimelineWorkItemVM): string => {
    const duePill = item.due_at
      ? `<span class="wh-pill"${item.overdue ? ' data-tone="overdue"' : ""}>${escapeHtml(
          `${goldPathCopyT(locale, "due3")} ${formatLocalDate(item.due_at)}`
        )}</span>`
      : `<span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "noDate"))}</span>`;
    const overduePill = item.overdue
      ? `<span class="wh-pill" data-tone="overdue">${escapeHtml(goldPathCopyT(locale, "overdue"))}</span>`
      : "";
    const blocksPill = item.blocks_count > 0
      ? `<span class="wh-pill" data-r15-timeline-blocks="${escapeHtml(String(item.blocks_count))}">${escapeHtml(
          zh ? `阻塞 ${item.blocks_count} 项` : `blocks ${item.blocks_count}`
        )}</span>`
      : "";
    // A2-37：取不到任务编号的依赖不再渲成 uuid 前 8 位——用户认不出那是哪一条，整条略过。
    const depCodes = item.depends_on.map((depId) => codeById.get(depId)).filter((code): code is string => Boolean(code));
    const depsPill = depCodes.length
      ? `<span class="wh-pill">${escapeHtml(`${goldPathCopyT(locale, "needs")} ${depCodes.join(" ")}`)}</span>`
      : "";
    // OKR 标注：悬停显目标名（G4 #36：VM 现带 objective_titles，服务端 join 得到；缺省/取名失败时
    // 回落成裸 id，与旧行为一致）。
    const okrHoverNames = item.objective_titles && item.objective_titles.length === (item.objective_ids?.length ?? 0)
      ? item.objective_titles
      : item.objective_ids ?? [];
    const okrPill = item.objective_ids && item.objective_ids.length
      ? `<span class="wh-pill" data-r15-timeline-okr="${escapeHtml(String(item.objective_ids.length))}" title="${escapeHtml(
          `${goldPathCopyT(locale, "objectives")} ${okrHoverNames.join(zh ? "、" : ", ")}`
        )}">${item.objective_ids.length > 1 ? `OKR ×${item.objective_ids.length}` : "OKR"}</span>`
      : "";
    const assigneePill = item.assignee
      ? `<span class="wh-pill">${escapeHtml(item.assignee.label)}</span>`
      : "";
    return `<div class="wh-r4-route-row" data-r15-timeline-item="${escapeHtml(item.id)}" data-r15-timeline-item-code="${escapeHtml(item.code)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(item.code)}</span>
          <span class="wh-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(workItemStatusLabel(locale, item.status))}</span>
          ${duePill}${overduePill}${blocksPill}${depsPill}${okrPill}${assigneePill}
        </div>
      </div>
    </div>`;
  };

  const knownMilestoneIds = new Set(vm.milestones.map((milestone) => milestone.id));
  const scheduleKey = (item: TimelineWorkItemVM): number => {
    const start = item.start_at ? Date.parse(item.start_at) : Number.NaN;
    const due = item.due_at ? Date.parse(item.due_at) : Number.NaN;
    if (!Number.isNaN(start)) return start;
    if (!Number.isNaN(due)) return due;
    return Number.MAX_SAFE_INTEGER;
  };
  const sortRows = (rows: TimelineWorkItemVM[]) => [...rows].sort((a, b) => scheduleKey(a) - scheduleKey(b));

  const groupSection = (title: string, dueLabel: string | undefined, doneTag: string, items: TimelineWorkItemVM[]): string => {
    const body = items.length
      ? `<div class="wh-r4-route-table">${sortRows(items).map(rowHtml).join("")}</div>`
      : `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noWorkItemsUnderThisMilestone"))}</p>`;
    return `<section class="wh-card wh-r4-route-card" data-r15-timeline-group="true">
      <h3 role="heading" aria-level="2">${escapeHtml(title)}${dueLabel ? ` <span class="wh-pill">${escapeHtml(dueLabel)}</span>` : ""}${doneTag}</h3>
      ${body}
    </section>`;
  };

  const milestoneSections = [...vm.milestones]
    .sort((a, b) => a.sort - b.sort)
    .map((milestone: ProjectMilestoneVM) => {
      const items = vm.items.filter((item) => item.milestone_id === milestone.id);
      const dueLabel = milestone.due_at ? `${goldPathCopyT(locale, "due3")} ${formatLocalDate(milestone.due_at)}` : undefined;
      const doneTag = milestone.status === "done"
        ? ` <span class="wh-pill" data-tone="done">${escapeHtml(goldPathCopyT(locale, "reached"))}</span>`
        : "";
      return groupSection(milestone.title, dueLabel, doneTag, items);
    })
    .join("");
  const unassignedItems = vm.items.filter((item) => !item.milestone_id || !knownMilestoneIds.has(item.milestone_id));
  const unassignedSection = unassignedItems.length
    ? groupSection(goldPathCopyT(locale, "noMilestone"), undefined, "", unassignedItems)
    : "";

  // 关键路径：逾期且卡着别人的项置顶警示。
  const criticalSection = vm.critical.overdue_blocking.length
    ? `<section class="wh-card wh-r4-route-card" data-r15-timeline-critical="${escapeHtml(String(vm.critical.overdue_blocking.length))}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "theseOverdueItemsBlockOthers"))}</h3>
        <div class="wh-r4-route-meta">${vm.critical.overdue_blocking
          .map((ref) => {
            // A2-37：取不到编号时只说「卡着 N 项」，不把 uuid 前 8 位当编号。
            const code = codeById.get(ref.work_item_id);
            const blocks = zh ? `卡着 ${ref.blocks_count} 项` : `blocks ${ref.blocks_count}`;
            return `<span class="wh-pill" data-tone="overdue">${escapeHtml(code ? `${code} · ${blocks}` : blocks)}</span>`;
          })
          .join("")}</div>
      </section>`
    : "";

  const isEmpty = vm.milestones.length === 0 && (vm.empty_state === "no_work_items" || vm.items.length === 0);
  const emptySection = isEmpty
    ? `<section class="wh-card wh-r4-route-card" data-r15-timeline-empty="true">
        <p class="wh-subtle">${escapeHtml(
          goldPathCopyT(locale, "thisProjectHasNoMilestonesOr")
        )}</p>
      </section>`
    : "";

  return createWebRouteComponent({
    key: "project-timeline",
    css: webRouteComponentCss,
    primaryHrefs: [`/projects/${vm.project.id}`],
    source: "page-vm",
    locale,
    pageVm: "project-timeline",
    html: `<section class="wh-r4-route" data-r4-route-component="project-timeline" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r15-timeline="${escapeHtml(vm.project.id)}" data-r15-timeline-milestone-count="${escapeHtml(String(vm.milestones.length))}" data-r15-timeline-item-count="${escapeHtml(String(vm.items.length))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathCopyT(locale, "timeline"))}</span>
          <h1>${escapeHtml(vm.project.name)}</h1>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(zh ? `里程碑 ${vm.milestones.length}` : `Milestones ${vm.milestones.length}`)}</span>
            <span class="wh-pill">${escapeHtml(zh ? `工作项 ${vm.items.length}` : `Work items ${vm.items.length}`)}</span>
          </div>
        </div>
        <div class="wh-r4-route-actions">
          <a class="wh-btn" href="/projects/${escapeHtml(vm.project.id)}" data-r15-timeline-back="true">${escapeHtml(goldPathCopyT(locale, "backToProject"))}</a>
        </div>
      </header>
      ${criticalSection}${emptySection}${milestoneSections}${unassignedSection}
    </section>`
  });
}

function renderCostRouteComponent(vm: CostDashboardVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createCostReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  const risks = vm.top_exhaustion_risks.length
    ? vm.top_exhaustion_risks.map((risk) => `<div role="listitem" class="wh-r4-route-row" data-r4-cost-risk="${escapeHtml(risk.label)}" data-r4-cost-risk-status="${escapeHtml(risk.status)}">
      <div>
        <strong>${escapeHtml(risk.label)}</strong>
        <p>${escapeHtml(`${routeT(locale, "cost.remaining")}: ${costAmount(risk.remaining_cost_cny, locale)}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(budgetStatusLabel(locale, risk.status))}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.emptyRisks"))}</p>`;
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
        ? `<span class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "whatYouCanDo"))}</span>${options.map((option) => `<span class="wh-pill" data-r4-cost-notice-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</span>`).join("")}`
        : "";
      const severityLabel = localizedEnumLabel(
        notice.severity,
        zhNotice,
        { info: "提示", warning: "提醒", critical: "严重" },
        { info: "Info", warning: "Warning", critical: "Critical" }
      );
      return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-cost-notice="${escapeHtml(notice.code)}" data-r4-cost-notice-severity="${escapeHtml(notice.severity)}">
      <div>
        <strong>${escapeHtml(severityLabel)}</strong>
        <p>${escapeHtml(notice.message)}</p>
      </div>
      ${optionButtons ? `<div class="wh-r4-route-actions">${optionButtons}</div>` : ""}
    </div>`;
    }).join("")
    : "";
  const models = vm.model_breakdown.slice(0, 5)
    .map((item) => `<div role="listitem" class="wh-r4-route-row" data-r4-cost-model="${escapeHtml(`${item.provider}:${item.model}`)}">
      <div>
        <strong>${escapeHtml(item.model)}</strong>
        <p>${escapeHtml(`${item.provider} · ${item.count} ${locale === "zh-CN" ? "次调用" : item.count === 1 ? "call" : "calls"}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
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
          ? `已超预算（${burnPct}%${item.budget_cny ? `，上限 ${costAmount(item.budget_cny, locale)}` : ""}）`
          : `Over budget (${burnPct}%${item.budget_cny ? `, cap ${costAmount(item.budget_cny, locale)}` : ""})`)} <a class="wh-btn" href="#wh-cost-budget" data-r9-cost-army-handle="true">${escapeHtml(goldPathCopyT(locale, "handleIt"))}</a></p>`
        : "";
      const statusPill = item.status
        ? `<span class="wh-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(taskPlanStatusLabel(locale, item.status as Parameters<typeof taskPlanStatusLabel>[1]))}</span>`
        : "";
      return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-cost-army-plan="${escapeHtml(item.task_plan_id)}">
      <div>
        <strong>${item.work_item_id
          ? `<a class="wh-r4-route-row-title" href="/workitems/${escapeHtml(encodeURIComponent(item.work_item_id))}" data-r9-cost-army-drill="${escapeHtml(item.task_plan_id)}" title="${escapeHtml(goldPathCopyT(locale, "openTheWorkItemToSee"))}">${escapeHtml(item.label ?? (goldPathCopyT(locale, "taskPlan2")))}</a>`
          : escapeHtml(item.label ?? (goldPathCopyT(locale, "taskPlan2")))}</strong>
        <p>${escapeHtml(routeTf(locale, "cost.subtaskCount", { count: item.child_runs }))}</p>
        ${burnMeter}
        ${overBudget}
      </div>
      <div class="wh-r4-route-meta">
        ${statusPill}
        <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
      </div>
    </div>`;
    })
    .join("");
  // 静默截断=撒谎：超过 8 个计划时明说只显示最烧钱的前 8。
  const armyCapNote = vm.by_task_plan.length > 8
    ? `<p class="wh-subtle" data-r9-cost-army-capped="true">${escapeHtml(routeTf(locale, "cost.armyCapped", { total: vm.by_task_plan.length }))}</p>`
    : "";
  // R3：非管理员的分组维度（按人/按 AI 小组/按目标）不可见时说明白，而不是当它不存在。
  // R19-6（R20 波4）：by_workitem / by_team 与前三个维度同一门槛（仅管理员非空）——补进这句说明，
  // 免得这两个维度对非管理员悄悄消失又没人解释为什么。
  const nonAdminNote = vm.viewer_is_admin === false
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-non-admin-note="true">
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "orgWideBreakdownsByPersonAgent"))}</p>
      </section>`
    : "";
  const armyCard = vm.by_task_plan.length
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-army="true" data-r9-cost-army-count="${escapeHtml(String(vm.by_task_plan.length))}">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "agentTeamSpend"))}</h3>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "agentTeamCostGroupedByTask"))}</p>
          <div class="wh-r4-route-timeline" role="list">${armyRows}</div>
          ${armyCapNote}
          <div class="wh-r4-route-actions"><a class="wh-btn" href="/dashboard/agents" data-r9-cost-army-cta="true">${escapeHtml(goldPathCopyT(locale, "openTheCommandDeck"))}</a></div>
        </section>`
    : "";
  // UX-M10（规格 §3.5 三维分组）：按人 / 按军团计划 / 按目标三个维度都要在成本页可达。
  // 静态渲染架构下做成并排卡（有数据才渲），不做假 tab。
  // R14 批 CHAT（web-avatars）：这一行早就带着 user_id + label 配对（记账维度就是「这个人」），只是
  // 此前只渲文字——头像 tile 直接铺在名字前面，onerror 天然回退回原来的纯文字观感。
  const byUserRows = vm.by_user.slice(0, 8)
    .map((item) => `<div role="listitem" class="wh-r4-route-row" data-r9-cost-user="${escapeHtml(item.user_id)}">
      <div>${personAvatarTileHtml({ userId: item.user_id, label: item.label })}<strong>${escapeHtml(item.label)}</strong></div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
    </div>`)
    .join("");
  // R5（规模化）：与 armyCapNote 同口径——超过 8 人时明说，不静默截断。
  const byUserCapNote = vm.by_user.length > 8
    ? `<p class="wh-subtle" data-r9-cost-by-user-capped="true">${escapeHtml(zhNotice
      ? `按花费只显示前 8 人（共 ${vm.by_user.length} 人）。`
      : `Showing the 8 costliest people of ${vm.by_user.length}.`)}</p>`
    : "";
  const byUserCard = vm.by_user.length
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-by-user="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "spendByPerson"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${byUserRows}</div>
          ${byUserCapNote}
        </section>`
    : "";
  const byObjectiveRows = vm.by_objective.slice(0, 8)
    .map((item) => `<div role="listitem" class="wh-r4-route-row" data-r9-cost-objective="${escapeHtml(item.objective_id)}">
      <div><strong>${escapeHtml(item.label ?? goldPathCopyT(locale, "untitledObjective"))}</strong></div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
    </div>`)
    .join("");
  const byObjectiveCapNote = vm.by_objective.length > 8
    ? `<p class="wh-subtle" data-r9-cost-by-objective-capped="true">${escapeHtml(zhNotice
      ? `按花费只显示前 8 个目标（共 ${vm.by_objective.length} 个）。`
      : `Showing the 8 costliest objectives of ${vm.by_objective.length}.`)}</p>`
    : "";
  const byObjectiveCard = vm.by_objective.length
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-by-objective="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "spendByObjective"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${byObjectiveRows}</div>
          ${byObjectiveCapNote}
        </section>`
    : "";
  // R19-6（R20 波4）：by_workitem 早就在 VM 里（与 by_user/by_team/by_objective 同门槛，仅管理员非空），
  // 桌面端 costView 已经渲了前 5 行并明确写着"去网页版成本页细看"（apps/desktop-webview/src/spotlight/
  // views/dashboards.ts）——但 web 端此前从未消费这个字段，指路指到了一处空白。补上按花费降序的行 +
  // 可点进工作项详情（与 by_task_plan 的 work_item_id 深链同一惯例），超 8 条时明说截断而非静默吞掉。
  const byWorkitemRows = vm.by_workitem.slice(0, 8)
    .map((item) => `<div role="listitem" class="wh-r4-route-row" data-r20-cost-workitem="${escapeHtml(item.workitem_id)}">
      <div>
        <a class="wh-r4-route-row-title" href="/workitems/${escapeHtml(encodeURIComponent(item.workitem_id))}" data-r20-cost-workitem-drill="${escapeHtml(item.workitem_id)}"><strong>${escapeHtml(item.code)}</strong></a>
        <p>${escapeHtml(zhNotice ? `${item.turns} 轮` : `${item.turns} ${item.turns === 1 ? "turn" : "turns"}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
    </div>`)
    .join("");
  const byWorkitemCapNote = vm.by_workitem.length > 8
    ? `<p class="wh-subtle" data-r20-cost-by-workitem-capped="true">${escapeHtml(zhNotice
      ? `按花费只显示前 8 个工作项（共 ${vm.by_workitem.length} 个）。`
      : `Showing the 8 costliest work items of ${vm.by_workitem.length}.`)}</p>`
    : "";
  const byWorkitemCard = vm.by_workitem.length
    ? `<section class="wh-card wh-r4-route-card" data-r20-cost-by-workitem="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.byWorkitem"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${byWorkitemRows}</div>
          ${byWorkitemCapNote}
        </section>`
    : "";
  // R19-6（R20 波4）：by_team 同样早就在 VM 里、同一 admin 门槛，此前也从未被渲染。标签当前后端固定给
  // "团队预算"（apps/api/src/pages/cost.ts 的 pageT(locale,"cost.label.teamBudget")，尚不区分多个团队），
  // 这里在标签下补一行短 team_id，避免多条同名行看起来像重复渲染同一条数据。
  const byTeamRows = vm.by_team.slice(0, 8)
    .map((item) => `<div role="listitem" class="wh-r4-route-row" data-r20-cost-team="${escapeHtml(item.team_id)}">
      <div>
        <strong>${escapeHtml(item.label)}</strong>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
    </div>`)
    .join("");
  const byTeamCapNote = vm.by_team.length > 8
    ? `<p class="wh-subtle" data-r20-cost-by-team-capped="true">${escapeHtml(zhNotice
      ? `按花费只显示前 8 个团队（共 ${vm.by_team.length} 个）。`
      : `Showing the 8 costliest teams of ${vm.by_team.length}.`)}</p>`
    : "";
  const byTeamCard = vm.by_team.length
    ? `<section class="wh-card wh-r4-route-card" data-r20-cost-by-team="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.byTeam"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${byTeamRows}</div>
          ${byTeamCapNote}
        </section>`
    : "";
  // R19-6（R20 波4）：trend 不像 by_workitem/by_team 那样按 isAdmin 收窄——buildCostDashboardPage 里
  // aggregateTrend 吃的是已经按用户身份筛过的 uniqueEntries（非管理员=只筛自己的账目），所以普通用户看到
  // 的 trend 就是自己范围内的每日花费，本身是安全的，不该被 nonAdminNote 盖住。此前 web 只把它的长度渲成
  // 顶部一个"统计天数: N"计数徽章（见下方 wh-r4-cost-metrics 卡），从没把序列本身画出来；桌面端已有 14 天
  // 条形图。这里用近 14 天、每天一行（日期+花费+token）+ 复用既有 .wh-r4-route-meter 相对条形，超 14 天
  // 明说只显示最近 14 天而不是静默截断。
  const trendSlice = vm.trend.slice(-14);
  const trendMax = Math.max(0.0001, ...trendSlice.map((point) => Number(point.cost_cny) || 0));
  const trendRows = trendSlice
    .map((point) => {
      const pct = Math.max(4, Math.round(((Number(point.cost_cny) || 0) / trendMax) * 100));
      return `<div role="listitem" class="wh-r4-route-row wh-r4-route-row--stacked" data-r20-cost-trend-day="${escapeHtml(point.date)}">
        <div>
          <strong>${escapeHtml(point.date)}</strong>
          <p>${escapeHtml(`${costAmount(point.cost_cny, locale)} · ${uiFormatCount(point.tokens, locale)} ${zhNotice ? "个 token" : point.tokens === 1 ? "token" : "tokens"}`)}</p>
          <div class="wh-r4-route-meter" aria-hidden="true"><span style="width:${escapeHtml(String(pct))}%"></span></div>
        </div>
      </div>`;
    })
    .join("");
  const trendCapNote = vm.trend.length > 14
    ? `<p class="wh-subtle" data-r20-cost-trend-capped="true">${escapeHtml(zhNotice
      ? `只显示最近 14 天（共 ${vm.trend.length} 天记录）。`
      : `Showing the most recent 14 days of ${vm.trend.length}.`)}</p>`
    : "";
  const trendCard = trendSlice.length
    ? `<section class="wh-card wh-r4-route-card" data-r20-cost-trend="true" data-r20-cost-trend-day-count="${escapeHtml(String(trendSlice.length))}">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.trendTitle"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${trendRows}</div>
          ${trendCapNote}
        </section>`
    : "";
  // R13 批 P4（labor-split 按 assignee 记账）：与 by_user 同构但维度不同——by_user 是记账时的
  // usage.userId（起意者/触发这次调用的身份），by_assignee 是 run 的真实执行身份
  // （agent_runs.actor_user_id）。系统桶（无 run 关联的账目，如夜间技能蒸馏）单独一行，
  // 不与任何真人的名字混在一起，也不静默吞掉这部分花费。
  // R14 批 CHAT（web-avatars）："按执行者分账"——vm.by_assignee 里 user_id 是可选的（系统桶=无 run
  // 关联的账目，没有对应真人），只在有 user_id 时铺头像；系统桶维持纯文字，不给它编一个假头像。
  const byAssigneeRows = vm.by_assignee.slice(0, 8)
    .map((item) => `<div role="listitem" class="wh-r4-route-row" data-r13-cost-assignee="${escapeHtml(item.user_id ?? "system")}">
      <div>
        ${item.user_id ? personAvatarTileHtml({ userId: item.user_id, label: item.label }) : ""}<strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(zhNotice ? `${item.run_count} 次运行` : `${item.run_count} ${item.run_count === 1 ? "run" : "runs"}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny, locale))}</span>
    </div>`)
    .join("");
  const byAssigneeCapNote = vm.by_assignee.length > 8
    ? `<p class="wh-subtle" data-r13-cost-by-assignee-capped="true">${escapeHtml(zhNotice
      ? `按花费只显示前 8 位执行者（共 ${vm.by_assignee.length} 位）。`
      : `Showing the 8 costliest assignees of ${vm.by_assignee.length}.`)}</p>`
    : "";
  const byAssigneeCard = vm.by_assignee.length
    ? `<section class="wh-card wh-r4-route-card" data-r13-cost-by-assignee="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "spendByAssignee"))}</h3>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "whoRanTheWorkAttributedTo"))}</p>
          <div class="wh-r4-route-timeline" role="list">${byAssigneeRows}</div>
          ${byAssigneeCapNote}
        </section>`
    : "";
  // R13 批 P4（KPI：AI 自动合并数/占比）：与 labor_split 同级——把「全托管档 AI 自己复核并合并了多少次」显性化，
  // 是 D 主题（全托管透明度）在成本页的落点。
  const aiAutoMergeCard = vm.ai_auto_merge
    ? `<section class="wh-card wh-r4-route-card" data-r13-cost-ai-auto-merge="true" data-r13-cost-ai-auto-merge-count="${escapeHtml(String(vm.ai_auto_merge.count))}" data-r13-cost-ai-auto-merge-ratio="${escapeHtml(String(vm.ai_auto_merge.ratio_pct))}">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "aiAutoMerges"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(zhNotice ? `今日 ${vm.ai_auto_merge.count} 次` : `${vm.ai_auto_merge.count} today`)}</span>
            <span class="wh-pill">${escapeHtml(zhNotice ? `占今日通过评审的 ${vm.ai_auto_merge.ratio_pct}%` : `${vm.ai_auto_merge.ratio_pct}% of today's approvals`)}</span>
          </div>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "underFullyManagedModeTier5"))}</p>
        </section>`
    : "";
  // K5：「干活 vs 自进化」分账卡——把夜间技能自迭代的开销显性化（复利劳动力的自我打磨成本）。
  const laborSplitCard = vm.labor_split
    ? `<section class="wh-card wh-r4-route-card" data-r4-cost-labor-split="true" data-r4-cost-self-improvement-ratio="${escapeHtml(String(vm.labor_split.self_improvement_ratio))}">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.laborSplit"))}</h3>
          <div class="wh-r4-route-timeline" role="list">
            <div role="listitem" class="wh-r4-route-row" data-r4-cost-labor="production">
              <div><strong>${escapeHtml(routeT(locale, "cost.laborProduction"))}</strong></div>
              <span class="wh-pill">${escapeHtml(costAmount(vm.labor_split.production_cost_cny, locale))}</span>
            </div>
            <div role="listitem" class="wh-r4-route-row" data-r4-cost-labor="self_improvement">
              <div>
                <strong>${escapeHtml(routeT(locale, "cost.laborSelfImprovement"))}</strong>
                <p>${escapeHtml(`${routeT(locale, "cost.laborSelfImprovementRatio")}: ${Math.round(vm.labor_split.self_improvement_ratio * 100)}%`)}</p>
              </div>
              <span class="wh-pill">${escapeHtml(costAmount(vm.labor_split.self_improvement_cost_cny, locale))}</span>
            </div>
          </div>
        </section>`
    : "";
  // L32：没有任何用量时，整页会显示「本期用量 0 / 估算成本 ¥0 / 风险 ok」一片零——一无所知的用户分不清
  // 究竟是 AI 免费、还没跑过、还是成本统计坏了。loader 已设 empty_state(no_agent_runs/usage_not_connected)，
  // 这里据此显式给出可操作说明，而不是默默摆一堆 0。
  const emptyStateCard = vm.empty_state
    ? `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-cost-empty-state="${escapeHtml(vm.empty_state)}">
          <h3 role="heading" aria-level="2">${escapeHtml(vm.empty_state === "usage_not_connected"
            ? (goldPathCopyT(locale, "usageTrackingNotConnected"))
            : (goldPathCopyT(locale, "noAiUsageYet")))}</h3>
          <p>${escapeHtml(vm.empty_state === "usage_not_connected"
            ? (goldPathCopyT(locale, "theFiguresBelowRead0Because"))
            : (goldPathCopyT(locale, "theFiguresBelowRead0For")))}</p>
          ${vm.empty_state === "no_agent_runs" /* term-allow：empty_state 枚举是 VM 标识符，非用户文案 */ ? `<div class="wh-r4-route-actions"><a class="wh-btn wh-btn-primary" href="/intake" data-r9-cost-empty-cta="true">${escapeHtml(goldPathCopyT(locale, "assignATask"))}</a></div>` : ""}
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
        <span class="wh-r4-route-count">${escapeHtml(costAmount(props.totalCostCny, locale))}</span>
      </header>
      ${emptyStateCard}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-cost-metrics="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(`${goldPathT(locale, "cost.tokenTitle")}: ${uiFormatCount(props.totalTokens, locale)} ${goldPathCopyT(locale, "tokens")}`)}</span>
            <span class="wh-pill">${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}: ${escapeHtml(costAmount(props.totalCostCny, locale))}</span>
            <span class="wh-pill" data-r4-cost-trend-days="${escapeHtml(String(props.trendCount))}">${escapeHtml(`${routeT(locale, "cost.trend")}: ${props.trendCount}`)}</span>
          </div>
          ${notices}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-risks="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.risks"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${risks}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" id="wh-cost-budget" data-r4-cost-budget="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.scopes"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${renderBudgetRows(vm, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-models="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "cost.models"))}</h3>
          <div class="wh-r4-route-timeline" role="list">${models || `<p role="listitem" class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.emptyModels"))}</p>`}</div>
          ${vm.model_breakdown.length > 5 ? `<p class="wh-subtle" data-r13-cost-models-capped="${escapeHtml(String(vm.model_breakdown.length - 5))}">${escapeHtml(locale === "zh-CN" ? `按花费只显示前 5 个模型（共 ${vm.model_breakdown.length} 个）。` : `Showing the 5 costliest models of ${vm.model_breakdown.length}.`)}</p>` : ""}
        </section>
      </div>
      ${trendCard}
      ${armyCard || laborSplitCard || aiAutoMergeCard ? `<div class="wh-r4-route-grid">${armyCard}${laborSplitCard}${aiAutoMergeCard}</div>` : ""}
      ${nonAdminNote}
      ${byUserCard || byObjectiveCard || byAssigneeCard || byWorkitemCard || byTeamCard ? `<div class="wh-r4-route-grid">${byUserCard}${byObjectiveCard}${byAssigneeCard}${byWorkitemCard}${byTeamCard}</div>` : ""}
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

function renderKnowledgeRouteComponent(vm: EvidenceBubble, locale: WorkHubLocale, sourceRef?: string, scopeLanding?: boolean, projects?: ProjectListVM): WebRouteComponent {
  const refs = vm.evidence_refs;
  // L34：非管理员、无项目/工作项范围时落到这张「检索需先锚定范围」的引导页。此时再摆一个全局搜索框只会
  // 让用户输入后再次 403 撞回同一页(死循环)。改为只给一条与引导文案一致的出路——去项目列表。
  const landingProjects = (projects?.projects ?? []).slice(0, 50);
  const searchBlock = scopeLanding
    ? `<div data-r4-knowledge-scope-landing="true">${landingProjects.length
      ? `<form class="wh-r4-knowledge-search" method="get" action="/knowledge/search" role="search" data-r12-knowledge-scope-form="true">
          <select class="wh-pill" name="project_id" aria-label="${escapeHtml(goldPathCopyT(locale, "pickAProjectToSearch"))}">${landingProjects.map((project, index) => `<option value="${escapeHtml(project.id)}"${index === 0 ? " selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}</select>
          <input type="search" name="q" maxlength="120" placeholder="${escapeHtml(routeT(locale, "knowledge.searchPlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "knowledge.searchLabel"))}" autocomplete="off" />
          <button class="wh-btn wh-btn-primary" type="submit">${escapeHtml(routeT(locale, "knowledge.searchSubmit"))}</button>
        </form>` : ""}
      <div class="wh-r4-route-actions"><a class="wh-btn${landingProjects.length ? "" : " wh-btn-primary"}" href="/projects" data-r4-knowledge-scope-cta="true">${escapeHtml(routeT(locale, "knowledge.scopeLandingCta"))}</a></div></div>`
    : `<form class="wh-r4-knowledge-search" method="get" action="/knowledge/search" role="search" data-r4-knowledge-search-form="true">
        <input type="search" name="q" value="${escapeHtml(vm.query_text ?? "")}" placeholder="${escapeHtml(routeT(locale, "knowledge.searchPlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "knowledge.searchLabel"))}" autocomplete="off" />
        <button class="wh-btn wh-btn-primary" type="submit">${escapeHtml(routeT(locale, "knowledge.searchSubmit"))}</button>
      </form>`;
  const sourceRows = refs.length
    ? refs.slice(0, 6).map((ref) => `<div role="listitem" class="wh-r4-route-row" data-r4-knowledge-evidence-ref="${escapeHtml(ref.id)}" data-r4-knowledge-source-type="${escapeHtml(ref.source_type)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      ${ref.href ? `<a class="wh-pill" href="${escapeHtml(safeHref(ref.href))}">${escapeHtml(routeT(locale, "knowledge.open"))}</a>` : `<span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>`}
    </div>`).join("") + (refs.length > 6 ? `<p class="wh-subtle" role="listitem" data-r10-knowledge-overflow="${escapeHtml(String(refs.length - 6))}">${escapeHtml(locale === "zh-CN" ? `还有 ${refs.length - 6} 条来源未展开（共 ${refs.length} 条），可换更具体的关键词缩小范围。` : `${refs.length - 6} more sources not shown (${refs.length} total) — narrow the query to see fewer, closer matches.`)}</p>` : "")
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
        <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "knowledge.sources"))}</h3>
        <div class="wh-r4-route-timeline" role="list">${sourceRows}</div>
        <div class="wh-r4-route-actions">${actions}</div>
      </section>
    </section>`
  });
}

// ── R15 批 web-mirror（web 只读会话镜像）─────────────────────────────────────────────
// 只读镜像 /conversations/:id 的消息渲染。语义忠实镜像桌面工作台的 chat 渲染
// （apps/desktop-webview/src/workbench/chat/render.ts），但刻意精简为「只读」形态：无 composer、
// 无任何写按钮（发送/反应/编辑/删除/置顶/已读上报全部不渲），管理者看一眼不改动任何人的未读游标。
// 消息 VM 只带 sender_user_id——昵称由 loader 传入的成员目录（GET /api/users）解析。

export type ConversationMirrorMember = { id: string; nickname: string };

export type ConversationMirrorInput = {
  conversationId: string;
  // 升序（旧→新），与读端点返回一致。
  messages: ConversationMessageVM[];
  members: ConversationMirrorMember[];
  // ?seq= 深链定位的目标消息 seq（高亮，不改动读游标）。
  targetSeq?: number | undefined;
  // 分页游标：present 即渲对应方向的翻页链接（before/after 语义照 conversationMessageListQuerySchema）。
  olderBeforeSeq?: number | undefined;
  newerAfterSeq?: number | undefined;
  // 当前是否停在「最新一页」——非最新时渲「回到最新」。
  isLatest: boolean;
  // 「刷新」按钮回链（= 当前 pathname+search，SPA 原地重新拉取）。
  refreshHref: string;
};

type MirrorRenderCtx = {
  locale: WorkHubLocale;
  memberNames: Map<string, string>;
  targetSeq?: number | undefined;
};

// R14 批 CHAT 定调：emoji 字形只允许活在渲染层的 slug→字形映射常量里（绝不进契约/文档）。这是 web
// 渲染层对应桌面 REACTION_EMOJI（render.ts）的同款常量，也是「界面不用 emoji」纪律里 reaction 的
// 唯一破例（见记忆：reaction 破例 emoji）。键序照契约枚举顺序。
const MIRROR_REACTION_ORDER: readonly ConversationReactionKey[] = ["approve", "disagree", "done", "question", "watch"];
const MIRROR_REACTION_EMOJI: Record<ConversationReactionKey, string> = {
  approve: "👍",
  disagree: "👎",
  done: "✅",
  question: "❓",
  watch: "👀"
};

function mirrorTime(iso: string | undefined): string {
  return formatApprovalTimestamp(iso);
}

// escapeHtml 打底 + 换行→<br>（与桌面 textMessageBodyHtml 同款，无 markdown）。
function mirrorTextHtml(text: string): string {
  return escapeHtml(text).replace(/\n/gu, "<br>");
}

function mirrorSenderLabel(senderType: string, senderUserId: string | null, ctx: MirrorRenderCtx): string {
  if (senderType === "cuu") {
    return routeT(ctx.locale, "conversation.senderCuu");
  }
  if (senderType === "system") {
    return routeT(ctx.locale, "conversation.senderSystem");
  }
  if (senderUserId) {
    const name = ctx.memberNames.get(senderUserId);
    if (name) {
      return name;
    }
  }
  return routeT(ctx.locale, "conversation.senderUnknown");
}

function mirrorAvatarHtml(senderType: string, senderUserId: string | null, ctx: MirrorRenderCtx): string {
  if (senderType === "cuu") {
    return `<span class="wh-mirror-avatar--cuu" aria-hidden="true">Cuu</span>`;
  }
  if (senderUserId) {
    return personAvatarTileHtml({ userId: senderUserId, label: ctx.memberNames.get(senderUserId) ?? "" });
  }
  return `<span class="wh-mirror-avatar--cuu" aria-hidden="true">·</span>`;
}

// 从任意受限对象内容里尽力取一段人话（summary→text→兜底），供 system_event/tool_note 朴素渲染。
function mirrorBestEffortNoteText(content: Record<string, unknown>, fallback: string): string {
  const summary = content["summary"];
  if (typeof summary === "string" && summary.trim()) {
    return summary;
  }
  const text = content["text"];
  if (typeof text === "string" && text.trim()) {
    return text;
  }
  return fallback;
}

function mirrorSettleOutcomeLabel(outcome: string, zh: boolean): string {
  return localizedEnumLabel(
    outcome,
    zh,
    { approved: "已通过", merged: "已采纳", rejected: "已打回" },
    { approved: "Approved", merged: "Adopted", rejected: "Sent back" }
  );
}

// system_event 朴素渲染：digest（今日风险巡检）/落定（提议/执行结算）各给一条可读摘要，其余回退到
// 尽力摘要。绝不复刻桌面的富交互卡（那些带按钮，只读镜像不要）。
function mirrorSystemEventText(content: Record<string, unknown>, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const sep = zh ? "：" : ": ";
  const event = typeof content["event"] === "string" ? content["event"] : "";
  const title = typeof content["title"] === "string" ? content["title"] : "";
  if (event === "risk_digest") {
    const summary = typeof content["summary"] === "string" ? content["summary"] : "";
    const head = routeT(locale, "conversation.riskDigest");
    return summary ? `${head}${sep}${summary}` : head;
  }
  if (event === "proposal_settled") {
    const label = mirrorSettleOutcomeLabel(typeof content["outcome"] === "string" ? content["outcome"] : "", zh);
    return title ? `${title} · ${label}` : label;
  }
  if (event === "run_settled_report") {
    const outcome = typeof content["outcome"] === "string" ? content["outcome"] : "";
    const label = outcome === "escalated"
      ? (goldPathCopyT(locale, "needsYourCall"))
      : (goldPathCopyT(locale, "didnTLandThisTime"));
    return title ? `${title} · ${label}` : label;
  }
  if (event === "proposal_opened") {
    return title ? (zh ? `已起草${sep}${title}` : `Drafted: ${title}`) : (goldPathCopyT(locale, "changeDrafted"));
  }
  if (event === "proposal_auto_merged") {
    return title ? (zh ? `已自动采纳${sep}${title}` : `Auto-adopted: ${title}`) : (goldPathCopyT(locale, "autoAdopted"));
  }
  return mirrorBestEffortNoteText(content, routeT(locale, "conversation.systemFallback"));
}

function renderMirrorReactions(reactions: ConversationMessageVM["reactions"], locale: WorkHubLocale): string {
  if (!reactions || reactions.length === 0) {
    return "";
  }
  const chips = MIRROR_REACTION_ORDER.map((key) => {
    const reaction = reactions.find((entry) => entry.key === key);
    if (!reaction || reaction.user_ids.length === 0) {
      return "";
    }
    return `<span class="wh-mirror-reaction" data-r15-mirror-reaction="${escapeHtml(key)}"><span class="wh-mirror-reaction-emoji" aria-hidden="true">${MIRROR_REACTION_EMOJI[key]}</span><span>${escapeHtml(String(reaction.user_ids.length))}</span></span>`;
  }).filter(Boolean).join("");
  return chips ? `<div class="wh-mirror-reactions">${chips}</div>` : "";
}

function renderMirrorReply(reply: NonNullable<ConversationMessageVM["reply_to"]>, ctx: MirrorRenderCtx): string {
  const who = mirrorSenderLabel(reply.sender_type, reply.sender_user_id, ctx);
  const inner = reply.deleted
    ? `<span class="wh-mirror-reply-text wh-mirror-reply-gone">${escapeHtml(routeT(ctx.locale, "conversation.replyDeleted"))}</span>`
    : `<span class="wh-mirror-reply-text">${escapeHtml(reply.preview_text)}</span>`;
  return `<span class="wh-mirror-reply" data-r15-mirror-reply-to="${escapeHtml(reply.message_id)}"><span class="wh-mirror-reply-who">${escapeHtml(who)}</span>${inner}</span>`;
}

function mirrorTextBodyHtml(content: Extract<ConversationMessageVM, { kind: "text" }>["content"], locale: WorkHubLocale): string {
  const body = `<p class="wh-mirror-text">${mirrorTextHtml(content.text)}</p>`;
  if (content.is_clarifying_question) {
    const options = Array.isArray(content.clarify_options) ? content.clarify_options : [];
    const optionsHtml = options.length
      ? `<div class="wh-mirror-clarify-opts">${options.map((option) => `<span class="wh-mirror-clarify-opt">${escapeHtml(option)}</span>`).join("")}</div>`
      : "";
    return `<div class="wh-mirror-clarify"><span class="wh-mirror-clarify-badge">${escapeHtml(routeT(locale, "conversation.clarifyBadge"))}</span>${body}${optionsHtml}</div>`;
  }
  return body;
}

function mirrorFileCardHtml(content: Extract<ConversationMessageVM, { kind: "file_card" }>["content"], locale: WorkHubLocale): string {
  const name = content.snapshot_name || routeT(locale, "conversation.fileCard");
  return `<span class="wh-mirror-filecard" data-r15-mirror-file-item="${escapeHtml(content.drive_item_id)}"><span aria-hidden="true">▤</span><span>${escapeHtml(name)}</span></span>`;
}

function mirrorActionCardHtml(content: Record<string, unknown>, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const rawItems = content["items"];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const count = items.length;
  const header = zh
    ? `Cuu 从讨论里拎出 ${count} 件事`
    : `Cuu pulled ${count} item${count === 1 ? "" : "s"} out of the discussion`;
  const list = items.slice(0, 8).map((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const titleMd = typeof record["title_md"] === "string" ? record["title_md"] : typeof record["title"] === "string" ? record["title"] : "";
    const title = stripMarkdown(titleMd);
    return `<span class="wh-mirror-clarify-opt">${escapeHtml(title || (goldPathCopyT(locale, "untitled")))}</span>`;
  }).join("");
  return `<div class="wh-mirror-clarify"><span class="wh-mirror-clarify-badge">${escapeHtml(header)}</span>${list ? `<div class="wh-mirror-clarify-opts">${list}</div>` : ""}</div>`;
}

function mirrorMessageBody(message: ConversationMessageVM, locale: WorkHubLocale): string {
  if (message.kind === "text") {
    return mirrorTextBodyHtml(message.content, locale);
  }
  if (message.kind === "file_card") {
    return mirrorFileCardHtml(message.content, locale);
  }
  if (message.kind === "action_card") {
    return mirrorActionCardHtml(message.content, locale);
  }
  return "";
}

function renderMirrorMessage(message: ConversationMessageVM, ctx: MirrorRenderCtx): string {
  const isTarget = ctx.targetSeq !== undefined && message.seq === ctx.targetSeq;
  const rowAttrs = `data-r15-mirror-message-id="${escapeHtml(message.id)}" data-r15-mirror-seq="${escapeHtml(String(message.seq))}"${isTarget ? " data-r15-mirror-target=\"true\"" : ""}`;
  // 墓碑优先（VM 已归一 content.text=''，但键仍看 deleted_at）——无头像/无工具条/无反应，只留一行占位。
  if (message.deleted_at !== undefined) {
    return `<div class="wh-mirror-tombstone" ${rowAttrs}>${escapeHtml(routeT(ctx.locale, "conversation.deleted"))}</div>`;
  }
  if (message.kind === "system_event") {
    return `<div class="wh-mirror-sysline" ${rowAttrs} data-r15-mirror-system-event="${escapeHtml(typeof (message.content as Record<string, unknown>)["event"] === "string" ? String((message.content as Record<string, unknown>)["event"]) : "")}"><span>${escapeHtml(mirrorSystemEventText(message.content as Record<string, unknown>, ctx.locale))}</span><span class="wh-mirror-sysline-tm">${escapeHtml(mirrorTime(message.created_at))}</span></div>`;
  }
  if (message.kind === "tool_note") {
    return `<div class="wh-mirror-note" ${rowAttrs} data-r15-mirror-tool-note="true"><span>${escapeHtml(mirrorBestEffortNoteText(message.content as Record<string, unknown>, routeT(ctx.locale, "conversation.toolNote")))}</span> <span class="wh-mirror-sysline-tm">${escapeHtml(mirrorTime(message.created_at))}</span></div>`;
  }
  const cuu = message.sender_type === "cuu";
  const who = mirrorSenderLabel(message.sender_type, message.sender_user_id, ctx);
  const edited = message.edited_at !== undefined
    ? `<span class="wh-mirror-edited">${escapeHtml(routeT(ctx.locale, "conversation.edited"))}</span>`
    : "";
  const pinned = message.pinned
    ? `<span class="wh-mirror-pin">${escapeHtml(routeT(ctx.locale, "conversation.pinned"))}</span>`
    : "";
  const reply = message.reply_to ? renderMirrorReply(message.reply_to, ctx) : "";
  const body = mirrorMessageBody(message, ctx.locale);
  const reactions = renderMirrorReactions(message.reactions, ctx.locale);
  const avatar = mirrorAvatarHtml(message.sender_type, message.sender_user_id, ctx);
  return `<div class="wh-mirror-msg${cuu ? " wh-mirror-msg--cuu" : ""}${isTarget ? " wh-mirror-msg--target" : ""}" ${rowAttrs}>
      ${avatar}
      <div class="wh-mirror-bub">
        <div class="wh-mirror-who"><span>${escapeHtml(who)}</span><span class="wh-mirror-tm">${escapeHtml(mirrorTime(message.created_at))}</span>${edited}${pinned}</div>
        ${reply}${body}${reactions}
      </div>
    </div>`;
}

function renderConversationRouteComponent(input: ConversationMirrorInput, locale: WorkHubLocale): WebRouteComponent {
  const zh = locale === "zh-CN";
  const memberNames = new Map(input.members.map((member) => [member.id, member.nickname] as const));
  const ctx: MirrorRenderCtx = { locale, memberNames, targetSeq: input.targetSeq };
  const base = `/conversations/${encodeURIComponent(input.conversationId)}`;
  // R18 批 H1（web 会话镜像成员管理）：SSR 出「参与者」侧区骨架——先渲加载态，由 apps/web/src/browser.ts
  // 的 bindConversationParticipantsPanel 拉 GET /participants 后按 scope/is_dm 渲成员条 + 群管理动作
  // （加人/移出，DM/main 只渲说明无动作），照 settings AI 面板/项目指令面板的「SSR 骨架 + 客户端水合」纪律。
  const participantsSection = `<section class="wh-card wh-r4-route-card wh-mirror-participants" data-r18-conversation-participants="true" data-r18-conversation-id="${escapeHtml(input.conversationId)}">
        <h2 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "participants"))}</h2>
        <div data-r18-conversation-participants-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingParticipants"))}</p></div>
      </section>`;
  const stream = input.messages.length === 0
    ? `<p class="wh-mirror-empty">${escapeHtml(routeT(locale, "conversation.empty"))}</p>`
    : input.messages.map((message) => renderMirrorMessage(message, ctx)).join("");
  const olderLink = input.olderBeforeSeq !== undefined
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(`${base}?before=${input.olderBeforeSeq}`))}" data-r15-mirror-older="true">${escapeHtml(routeT(locale, "conversation.older"))}</a>`
    : "";
  const newerLink = input.newerAfterSeq !== undefined
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(`${base}?after=${input.newerAfterSeq}`))}" data-r15-mirror-newer="true">${escapeHtml(routeT(locale, "conversation.newer"))}</a>`
    : "";
  const latestLink = input.isLatest
    ? ""
    : `<a class="wh-btn" href="${escapeHtml(safeHref(base))}" data-r15-mirror-latest="true">${escapeHtml(routeT(locale, "conversation.latest"))}</a>`;
  const refreshLink = `<a class="wh-btn" href="${escapeHtml(safeHref(input.refreshHref))}" data-r15-mirror-refresh="true">${escapeHtml(routeT(locale, "conversation.refresh"))}</a>`;
  return createWebRouteComponent({
    key: "conversation",
    css: webRouteComponentCss,
    primaryHrefs: [],
    source: "page-vm",
    locale,
    pageVm: "conversation",
    html: `<section class="wh-r4-route wh-mirror" data-r4-route-component="conversation" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r15-conversation-mirror="true" data-r15-conversation-id="${escapeHtml(input.conversationId)}" data-r15-conversation-readonly="true"${input.targetSeq !== undefined ? ` data-r15-conversation-target-seq="${escapeHtml(String(input.targetSeq))}"` : ""}>
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "conversation.kicker"))}</span>
          <h1>${escapeHtml(routeT(locale, "conversation.title"))}</h1>
        </div>
      </header>
      <div class="wh-mirror-banner" role="note" data-r15-conversation-readonly-banner="true">
        <strong>${escapeHtml(routeT(locale, "conversation.readonlyBanner"))}</strong>
        <p>${escapeHtml(routeT(locale, "conversation.readonlyHint"))}</p>
      </div>
      ${participantsSection}
      <div class="wh-mirror-pager" data-r15-mirror-pager="top">${olderLink}${refreshLink}</div>
      <div class="wh-mirror-stream" data-r15-mirror-stream="true">${stream}</div>
      <div class="wh-mirror-pager" data-r15-mirror-pager="bottom">${newerLink}${latestLink}</div>
    </section>`
  });
}

// R14 批 SEARCH（web-search-page，02-search-design.md §7）：web 顶栏搜索页。服务端只渲搜索框外壳 +
// 诚实的空/短词提示（q 未给 or <2 字符）——四个结果分组卡先隐藏、不带数据。真结果由
// apps/web/src/browser.ts 的 bindSearchRoutePanel 客户端拉 GET /api/search（q≥2 字符时）后注入，
// 照 renderNotificationMutePanel/renderSettingsAiAssistantCard 的「SSR 骨架 + 客户端水合解禁」纪律
// （见 route-components.ts:4382 起的settings AI面板与 notifications 静音面板先例）。四组固定顺序=
// SEARCH_SCOPE_ORDER（conversations/drive/work_items/meetings），中文组标题「会话/网盘/任务/会议」
// （用「任务」而非「工单」，与本页面其余导航/标题已用的「任务」措辞对齐，见 nav.workitem）。
// 会话结果 web 端没有聊天页可跳（R13 定调"聊天归桌面"）——不渲染成链接，只给一条诚实说明。
const SEARCH_GROUP_SCOPES = ["conversations", "drive", "work_items", "meetings"] as const;

function searchGroupTitleKey(scope: typeof SEARCH_GROUP_SCOPES[number]): RouteCopyKey {
  if (scope === "conversations") {
    return "search.groupConversations";
  }
  if (scope === "drive") {
    return "search.groupDrive";
  }
  if (scope === "work_items") {
    return "search.groupWorkItems";
  }
  return "search.groupMeetings";
}

function renderSearchRouteComponent(q: string | undefined, locale: WorkHubLocale): WebRouteComponent {
  const trimmed = (q ?? "").trim();
  const hasValidQuery = trimmed.length >= 2;
  const promptKey = !q ? "search.promptEmpty" : !hasValidQuery ? "search.promptShort" : "search.loading";
  const groups = SEARCH_GROUP_SCOPES.map((scope) => `<section class="wh-card wh-r4-route-card" data-r14-search-group="${escapeHtml(scope)}" hidden>
        <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, searchGroupTitleKey(scope)))}</h3>
        ${scope === "conversations" ? `<p class="wh-subtle">${escapeHtml(routeT(locale, "search.desktopOnlyNote"))}</p>` : ""}
        <div class="wh-r4-route-timeline" role="list" data-r14-search-group-list="true"></div>
        <p class="wh-subtle" data-r14-search-group-more="true" hidden></p>
      </section>`).join("");
  return createWebRouteComponent({
    key: "search",
    css: webRouteComponentCss,
    primaryHrefs: [],
    source: "page-vm",
    locale,
    pageVm: "search",
    html: `<section class="wh-r4-route" data-r4-route-component="search" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r14-search-route="true" data-r14-search-query="${escapeHtml(trimmed)}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "search.kicker"))}</span>
          <h1>${escapeHtml(routeT(locale, "search.title"))}</h1>
          <p>${escapeHtml(routeT(locale, "search.summary"))}</p>
        </div>
      </header>
      <form class="wh-r14-search-form" method="get" action="/dashboard/search" role="search" data-r14-search-form="true">
        <input type="search" name="q" value="${escapeHtml(trimmed)}" minlength="2" maxlength="64" placeholder="${escapeHtml(routeT(locale, "search.placeholder"))}" aria-label="${escapeHtml(routeT(locale, "search.label"))}" autocomplete="off" />
        <button class="wh-btn wh-btn-primary" type="submit">${escapeHtml(routeT(locale, "search.submit"))}</button>
      </form>
      <p class="wh-subtle" data-r14-search-status="${hasValidQuery ? "loading" : "prompt"}">${escapeHtml(routeT(locale, promptKey))}</p>
      <button type="button" class="wh-btn" data-r14-search-retry="true" hidden>${escapeHtml(goldPathCopyT(locale, "retry"))}</button>
      <div class="wh-r4-route-stack" data-r14-search-results="true" ${hasValidQuery ? "" : "hidden"}>${groups}</div>
    </section>`
  });
}

// R13 批 P3（功能审查 B4）：web /settings 的「AI 助手」区块——web-only 用户此前对 5 类 AI 配置零入口，
// mode=1（只观察）的用户被 409 永久拒绝且无法自救。这里给 default_mode 与 dispatch_policy 两个真表单
// （PATCH /api/me/ai-profile 已有）；其余 AI 项（Granular/Cuu 主动性/模型档位/项目治理）诚实标注
// 「需要桌面客户端」（data-requires-desktop 既有模式，同下方 open_desktop_settings 按钮）。
// 两个 <select> 服务端渲染为 disabled——当前档位不在 SettingsPageVM 里（设置页 VM 不带用户 AI 档案，
// 扩 VM 要动 contracts/routes，超出本批范围围栏），由 apps/web/src/browser.ts 的
// bindSettingsAiProfilePanel 拉 GET /api/me/ai-profile 回填后解禁——照通知页静音面板（R10-P1-7）的
// 水合竞态收口纪律：读不到当前值就保持锁定 + 显式错误 + 重试，绝不让用户在「假的默认选项」上保存。
function renderSettingsAiAssistantCard(locale: WorkHubLocale, desktopHref: string): string {
  const zh = locale === "zh-CN";
  const modeOptions: Array<[string, string, string]> = [
    ["1", "1 · 只观察", "1 · Observe only"],
    ["2", "2 · 全部先问", "2 · Ask first"],
    ["3", "3 · 分级自动（默认）", "3 · Tiered auto (default)"],
    ["4", "4 · 全自动 · 人审", "4 · Full auto, human review"],
    ["5", "5 · 全托管 · AI 审", "5 · Fully managed, AI review"]
  ];
  const dispatchOptions: Array<[string, string, string]> = [
    ["auto", "自动接单（指派即开工）", "Auto-accept (starts on assignment)"],
    ["ask", "先问我（确认后开工）", "Ask me first (starts after I confirm)"],
    ["manual", "只挂单（我手动启动）", "Queue only (I start it manually)"]
  ];
  // R23 P3b（SA-07）：助手主动性三档。措辞与桌面端设置页逐字对齐（apps/desktop-webview/src/
  // spotlight/views/settings.ts 的 proactivityCopy），免得同一个档位在两端叫法不一样。
  const proactivityOptions: Array<[string, string, string]> = [
    ["quiet", "安静 · 很少主动开口", "Quiet · rarely speaks up first"],
    ["balanced", "均衡 · 看情况开口（默认）", "Balanced · speaks up when it matters (default)"],
    ["proactive", "主动 · 更常主动汇报", "Proactive · reports progress more often"]
  ];
  const renderOptions = (options: Array<[string, string, string]>) =>
    options.map(([value, zhLabel, enLabel]) => `<option value="${escapeHtml(value)}">${escapeHtml(zh ? zhLabel : enLabel)}</option>`).join("");
  return `<section class="wh-card wh-r4-route-card" data-r13-settings-ai-panel="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "aiAssistant"))}</h3>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "changeYourDefault11Mode"))}</p>
          <p class="wh-subtle" data-r13-settings-ai-status="loading" hidden></p>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "defaultMode11FiveLevels"))}</strong>
            <select class="wh-pill" data-r13-settings-ai-mode-select aria-label="${escapeHtml(goldPathCopyT(locale, "defaultMode"))}" disabled>${renderOptions(modeOptions)}</select>
          </div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "dispatchPolicy"))}</strong>
            <select class="wh-pill" data-r13-settings-ai-dispatch-select aria-label="${escapeHtml(goldPathCopyT(locale, "dispatchPolicy"))}" disabled>${renderOptions(dispatchOptions)}</select>
          </div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "assistantProactivity"))}</strong>
            <select class="wh-pill" data-r13-settings-ai-proactivity-select aria-label="${escapeHtml(goldPathCopyT(locale, "assistantProactivity"))}" disabled>${renderOptions(proactivityOptions)}</select>
          </div>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "turnItDownAndCareMessages"))}</p>
          <button type="button" class="wh-btn" data-r13-settings-ai-retry hidden>${escapeHtml(goldPathCopyT(locale, "retryLoading"))}</button>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "granularSwitchesModelTierProjectGovernance"))}</strong><span class="wh-pill">${escapeHtml(goldPathCopyT(locale, "desktopAppRequired"))}</span></div>
          <a class="wh-btn" href="${escapeHtml(safeHref(desktopHref))}" data-action-id="open_desktop_ai_settings" data-method="GET" data-requires-desktop="true">${escapeHtml(goldPathCopyT(locale, "adjustTheRestInTheDesktop"))}</a>
        </section>`;
}

// R13 批 A2（派人推荐 v2）：web /settings 的「我的资料」区块——GET/PATCH /me/profile 此前完全没有
// 任何 UI 入口（user_profiles 是零接线死表）。与上面的「AI 助手」卡同一套水合竞态收口纪律：三个输入
// 服务端渲染为 disabled，由 apps/web/src/browser.ts 的 bindSettingsMyProfilePanel 拉取当前值回填后
// 才解禁，读取失败保持锁定 + 显式错误 + 重试，不让用户在假的空白表单上覆盖已保存的资料。
function renderSettingsMyProfileCard(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  // R14 批 ONBOARD（资料引导提示，2026-07-14）：本来想在决策队列（/attention）首页也放一张「资料为空」
  // 提示卡，但 AttentionHomeVM（packages/contracts/src/pages.ts 的 attentionHomeVmSchema）完全不带任何
  // viewer 资料态字段（primary/queue/source_warnings/background_runs/cuu_state/worklog，没一个能判断
  // 「这个人资料填没填」）——服务端不给这个信号，前端没法诚实地只在"资料为空"时才显示，只能瞎猜着常显
  // 或者常隐，两者都不对。范围围栏也不许为了这一条改 API/VM，所以退化成这里：资料卡顶部常驻加一句
  // 点破用途的引导语，不看条件（04 §4 铁律 3 的精神延伸：宁可老实地"总是提示"，不假装能判断"要不要提示"）。
  // 决策队列版本的提示卡留作后续项，见本批汇报。
  return `<section class="wh-card wh-r4-route-card" data-r13-settings-profile-panel="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "myProfile"))}</h3>
          <p class="wh-subtle" data-r14-settings-profile-guidance-hint="true">${escapeHtml(goldPathCopyT(locale, "fillTheseInTheAiAssistant"))}</p>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "theAiAssistantUsesThisInformation"))}</p>
          <p class="wh-subtle" data-r13-settings-profile-status="loading" hidden></p>
          <div role="listitem" class="wh-r4-route-row" data-r14-settings-avatar-row="true"><strong>${escapeHtml(goldPathCopyT(locale, "avatar"))}</strong>
            <div class="wh-avatar-field">
              <span class="wh-avatar-preview" data-r14-avatar-preview="true">
                <span class="wh-avatar-fallback" data-r14-avatar-fallback="true" aria-hidden="true">?</span>
                <img class="wh-avatar-img" data-r14-avatar-img="true" alt="${escapeHtml(goldPathCopyT(locale, "currentAvatar"))}" hidden />
              </span>
              <label class="wh-btn wh-avatar-upload-label" data-r14-avatar-upload-label="true">
                <span>${escapeHtml(goldPathCopyT(locale, "changeAvatar"))}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" class="wh-avatar-file-input" data-r14-avatar-file-input="true" hidden disabled />
              </label>
              <button type="button" class="wh-btn" data-r14-avatar-remove-btn="true" hidden disabled>${escapeHtml(goldPathCopyT(locale, "removeAvatar"))}</button>
              <p class="wh-subtle" data-r14-avatar-status="true" hidden></p>
            </div>
          </div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "titleRole"))}</strong>
            <input type="text" class="wh-pill" data-r13-settings-profile-title-input aria-label="${escapeHtml(goldPathCopyT(locale, "titleRole"))}" placeholder="${escapeHtml(goldPathCopyT(locale, "eGFrontendLead"))}" maxlength="128" disabled />
          </div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "bio"))}</strong>
            <textarea class="wh-pill" data-r13-settings-profile-bio-input aria-label="${escapeHtml(goldPathCopyT(locale, "bio"))}" rows="3" maxlength="4000" placeholder="${escapeHtml(goldPathCopyT(locale, "aShortBio"))}" disabled></textarea>
          </div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(goldPathCopyT(locale, "skillTags"))}</strong>
            <input type="text" class="wh-pill" data-r13-settings-profile-skills-input aria-label="${escapeHtml(goldPathCopyT(locale, "skillTagsCommaSeparated"))}" placeholder="${escapeHtml(goldPathCopyT(locale, "commaSeparatedEGReactTypescript"))}" disabled />
          </div>
          <button type="button" class="wh-btn" data-r13-settings-profile-retry hidden>${escapeHtml(goldPathCopyT(locale, "retryLoading"))}</button>
        </section>`;
}

// R20 P2-05（设备管理 API 完整但零 UI）：web /settings 的「已登录设备」区块——GET/POST
// /api/client-devices/{me,current,:id/revoke} 后端四端点早就齐了（auth.test.ts 覆盖），但从未接过任何
// 前端 UI。这里只出加载态骨架（不是 admin 分区——设备是个人账号维度，任何登录用户都能看自己的设备）；
// apps/web/src/browser.ts 的 bindSettingsDevicesPanel 拉 GET /api/client-devices/me 渲染列表（设备名/
// 平台/最近活跃本地化），尽力探测 GET /api/client-devices/current 标出「本机」（纯网页会话没有本地客户端
// client-token 请求头，探测预期 403——折叠为「无法判定」，不假装/不误标），并接 POST /:id/revoke（两段式
// 确认，同 P2-08 参与者移出的 armConfirmButton 范式；已撤销/本机行不出撤销按钮）。判定逻辑拆在
// apps/web/src/settings-devices.ts（纯函数，供单测覆盖）。
function renderSettingsDevicesCard(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  return `<section class="wh-card wh-r4-route-card" data-r20-settings-devices="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "signedInDevices"))}</h3>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "clientDevicesPairedToThisAccount"))}</p>
          <div data-r20-settings-devices-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingDevices"))}</p></div>
        </section>`;
}

// R18 批 H1（web 工作区成员管理）：/settings 的「成员」分区——仅管理员可见（isAdmin 由外壳登录态给，
// 同 memory 路由的团队技能 tab 编辑权来源）。SSR 只出加载态骨架，apps/web/src/browser.ts 的
// bindSettingsMembersPanel 拉 GET /api/workspace/members 渲 roster（昵称/角色/加入时间）+ 移出/改角色
// （PATCH/DELETE /api/workspace/members/:userId），并拉 GET/POST /api/auth/invites 做邀请与未过期邀请
// 清单。非管理员不渲此分区（服务端各端点也再门控一遍，不靠前端自觉）。
function renderSettingsMembersSection(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  return `<p class="wh-r4-route-kicker" data-r18-settings-members-kicker="true">${escapeHtml(goldPathCopyT(locale, "teamMembersAdmins"))}</p>
      <div class="wh-r4-route-grid" data-r18-settings-members-grid="true">
        <section class="wh-card wh-r4-route-card" data-r18-settings-members="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "members"))}</h3>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "manageMembersRolesAndRemovalYou"))}</p>
          <div data-r18-settings-members-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingMembers"))}</p></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r18-settings-invites="true">
          <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "inviteMembers"))}</h3>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "generateAOneTimeInviteToken"))}</p>
          <div data-r18-settings-invites-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingInvites"))}</p></div>
          <!-- R20 P1-05：令牌展示区是 body 的持久兄弟节点，不在水合重建的 [data-r18-settings-invites-body] 域内——
               生成邀请后重拉未过期清单（重建 body）绝不会销毁刚展示的一次性令牌，令牌可持续可见可复制。 -->
          <div data-r18-settings-invite-token="true" hidden></div>
        </section>
      </div>`;
}

// R20 wave4（R19-2 AI 预算策略前端接线）：GET /api/cost/policies 与 PUT /api/cost/policies/:scope/:id
// 服务端早已有（admin-only），此前没有任何前端入口——非管理员连 GET 都是 403，所以只在 isAdmin 为真时
// 渲这张卡（同上面成员分区的既有先例：非管理员该分区在 SSR 阶段就整体省略，不是渲了又禁用）。真实数据
// 由 apps/web/src/browser.ts 的 bindSettingsBudgetPolicyPanel 拉取回填，SSR 只出加载态骨架。
function renderSettingsBudgetPolicySection(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  return `<section class="wh-card wh-r4-route-card" data-r20-settings-budget-policies="true">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "aiBudgetPoliciesAdmins"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "tokenAndSpendCapsForThe"))}</p>
        <p class="wh-subtle" data-r20-settings-budget-policies-status="loading" hidden></p>
        <div data-r20-settings-budget-policies-body="true"><p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "loadingBudgetPolicies"))}</p></div>
      </section>`;
}

// R23 P4（R20 P2A 端点上界面）：/settings 的「工作区审计」分区——GET /api/workspace/audit 服务端早已
// 齐备（workspace-audit.ts，仅管理员），此前两端零界面：谁改了什么、什么时候改的，管理员在界面上根本
// 查不到。非管理员连 GET 都是 403，所以整块只在 isAdmin 为真时渲（同成员分区/预算策略分区的既有做法）。
// SSR 只出加载态骨架，真实数据由 apps/web 的 bindSettingsWorkspaceAuditPanel 分页拉取。
function renderSettingsWorkspaceAuditSection(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  return `<section class="wh-card wh-r4-route-card" data-r23-settings-workspace-audit="true">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "workspaceAuditAdmins"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "whatHasHappenedInThisWorkspace"))}</p>
        <div class="wh-r4-route-timeline" role="list" data-r23-settings-workspace-audit-body="true"><p class="wh-subtle" data-r23-settings-workspace-audit-loading="true">${escapeHtml(goldPathCopyT(locale, "loadingAuditEntries"))}</p></div>
        <div class="wh-r4-route-actions"><button type="button" class="wh-btn" data-r23-settings-workspace-audit-more="true" hidden>${escapeHtml(goldPathCopyT(locale, "loadMore"))}</button></div>
        <p class="wh-subtle" data-r23-settings-workspace-audit-status="true" hidden></p>
      </section>`;
}

// R24-P 阶段 1：网页设置页的**只读**插件清单（仅管理员——服务端只给管理员填 vm.plugins，
// 非管理员时字段结构性缺席，整区不渲）。网页刻意不做安装/启停：安装要给一个本机绝对路径，
// 那是「这台服务器上的目录」，只在桌面端说得通；这里只回答「这个部署上装了什么、还活着吗」，
// 动作入口指向桌面客户端（与「自动通过规则」区块同款分工）。
function settingsPluginStatusLabel(
  plugin: NonNullable<SettingsPageVM["plugins"]>[number],
  zh: boolean
): string {
  if (!plugin.enabled || plugin.status === "disabled") {
    return goldPathCopyT(zh, "disabled");
  }
  if (plugin.status === "load_failed") {
    return goldPathCopyT(zh, "wonTLoad");
  }
  return zh
    ? `已启用 · ${plugin.tool_count} 个工具`
    : `Enabled · ${plugin.tool_count} tool${plugin.tool_count === 1 ? "" : "s"}`;
}

function settingsPluginCompatNote(
  plugin: NonNullable<SettingsPageVM["plugins"]>[number],
  zh: boolean
): string {
  if (plugin.compat_verdict === "blocked") {
    return goldPathCopyT(zh, "thePreInstallCheckFoundIt");
  }
  if (plugin.compat_verdict === "warn") {
    return goldPathCopyT(zh, "thePreInstallCheckRaisedA");
  }
  return "";
}

function renderSettingsPluginsSection(vm: SettingsPageVM, locale: WorkHubLocale): string {
  const plugins = vm.plugins;
  if (!plugins) {
    return "";
  }
  const zh = locale === "zh-CN";
  const body = plugins.length === 0
    ? `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noPluginsInstalledYet"))}</p>`
    : plugins
        .map((plugin) => `<div role="listitem" class="wh-r4-route-row" data-r24-settings-plugin="${escapeHtml(plugin.id)}" data-r24-settings-plugin-status="${escapeHtml(plugin.status)}">
            <div>
              <strong>${escapeHtml(plugin.version ? `${plugin.name} ${plugin.version}` : plugin.name)}</strong>
              <p>${escapeHtml(`${settingsPluginStatusLabel(plugin, zh)}${settingsPluginCompatNote(plugin, zh)}`)}</p>
            </div>
          </div>`)
        .join("");
  return `<section class="wh-card wh-r4-route-card" data-r24-settings-plugins="${escapeHtml(String(plugins.length))}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "plugins"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "pluginsInstalledOnThisServerDeepseek")
        )}</p>
        <div class="wh-r4-route-timeline" role="list">${body}</div>
      </section>`;
}

function renderSettingsRouteComponent(vm: SettingsPageVM, locale: WorkHubLocale, isAdmin = false): WebRouteComponent {
  const membersSection = isAdmin ? renderSettingsMembersSection(locale) : "";
  const budgetPolicySection = isAdmin ? renderSettingsBudgetPolicySection(locale) : "";
  const workspaceAuditSection = isAdmin ? renderSettingsWorkspaceAuditSection(locale) : "";
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
    html: `<section class="wh-r4-route" data-r4-route-component="settings" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-settings-generated-at="${escapeHtml(props.generatedAt)}" data-r4-settings-runtime-status="${escapeHtml(props.runtimeStatus)}" data-r4-settings-broker="${escapeHtml(props.brokerBackend)}" data-r4-settings-worker-count="${escapeHtml(String(props.workerCount))}" data-r4-settings-active-locale="${escapeHtml(props.activeLocale)}" data-r4-settings-preference-locale="${escapeHtml(props.preferenceLocale)}" data-r4-settings-preference-source="${escapeHtml(props.preferenceSource)}" data-r4-settings-preference-synced="${escapeHtml(String(props.preferenceSynced))}" data-r4-settings-pet-model-in-web="${escapeHtml(String(props.petModelSettingsInWeb))}" data-r4-settings-desktop-client="${escapeHtml(props.desktopClient)}" data-r4-settings-local-boundary="${escapeHtml(String(props.localExecutionBoundary))}" data-r4-settings-restore-requires-desktop="${escapeHtml(String(props.restoreRequiresDesktop))}" data-r4-settings-web-local-actions="${escapeHtml(String(props.webLocalActionsEnabled))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "settings.kicker"))}</span>
          <h1>${escapeHtml(goldPathT(locale, "settings.title"))}</h1>
          <p>${escapeHtml(goldPathT(locale, "settings.summary"))}</p>
        </div>
      </header>
      <p class="wh-r4-route-kicker" data-r10-settings-personal="true">${escapeHtml(goldPathCopyT(locale, "personalSettings"))}</p>
      <div class="wh-r4-route-grid" data-r10-settings-personal-grid="true">
        <section class="wh-card wh-r4-route-card" data-r4-settings-language="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "settings.language"))}</h3>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.activeLocale"))}</strong><span class="wh-pill">${escapeHtml(props.activeLocale)}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceLocale"))}</strong><span class="wh-pill">${escapeHtml(props.preferenceLocale)}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSource"))}</strong><span class="wh-pill">${escapeHtml(preferenceSourceLabel(props.preferenceSource, locale === "zh-CN"))}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSync"))}</strong><span class="wh-pill">${escapeHtml(syncLabel(props.preferenceSynced, locale))}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.supported"))}</strong><span class="wh-pill">${escapeHtml(props.supportedLocales.join(" / "))}</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-device="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "settings.device"))}</h3>
          <div role="listitem" class="wh-r4-route-row" title="${escapeHtml(goldPathCopyT(locale, "yesMeansLocalActionsFileWrites"))}"><strong>${escapeHtml(routeT(locale, "settings.localExecution"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.localExecutionBoundary))}</span></div>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "yesLocalActionsRunOnlyIn"))}</p>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.independentPet"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.independentPetWindow))}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.petBoundary"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, !props.petModelSettingsInWeb))}</span></div>
          <div role="listitem" class="wh-r4-route-row" title="${escapeHtml(goldPathCopyT(locale, "restoringDeliverablesToLocalFilesRequires"))}"><strong>${escapeHtml(routeT(locale, "settings.desktopGate"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.restoreRequiresDesktop))}</span></div>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "restoringDeliverablesToLocalFilesNeeds"))}</p>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.webLocalActions"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.webLocalActionsEnabled))}</span></div>
          <a class="wh-btn" href="${escapeHtml(safeHref(props.restoreHref))}" data-action-id="open_desktop_settings" data-method="GET" data-requires-desktop="${escapeHtml(String(props.restoreRequiresDesktop))}">${escapeHtml(routeT(locale, "settings.restore"))}</a>
        </section>
        ${renderSettingsAiAssistantCard(locale, props.restoreHref)}
        ${renderSettingsMyProfileCard(locale)}
        ${renderSettingsDevicesCard(locale)}
      </div>
      ${vm.permission_policies !== undefined ? `<section class="wh-card wh-r4-route-card" data-r9-settings-policies="${escapeHtml(String(vm.permission_policies.length))}">
        <h3 role="heading" aria-level="2">${escapeHtml(goldPathCopyT(locale, "autoApproveRules"))}</h3>
        <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "standingRulesFromAlwaysAllowLive"))}</p>
        <div class="wh-r4-route-timeline" role="list">${vm.permission_policies.length
          ? vm.permission_policies.map((policy) => `<div role="listitem" class="wh-r4-route-row" data-r9-settings-policy="${escapeHtml(policy.id)}">
            <div>
              <strong>${escapeHtml(policy.action_pattern)}</strong>
              <p>${escapeHtml(`${policy.effect === "allow" ? (goldPathCopyT(locale, "autoAllow")) : policy.effect === "deny" ? (goldPathCopyT(locale, "autoDeny")) : (goldPathCopyT(locale, "ask"))}${policy.learned_from_session ? (goldPathCopyT(locale, "learnedFromApproval")) : ""}`)}</p>
            </div>
            <a class="wh-btn" href="${escapeHtml(safeHref(policy.revoke_href))}" data-action-id="revoke_policy" data-method="DELETE" data-requires-desktop="true">${escapeHtml(goldPathCopyT(locale, "revoke"))}</a>
          </div>`).join("")
          : `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "noStandingRulesYet"))}</p>`}</div>
      </section>` : ""}
      ${renderSettingsPluginsSection(vm, locale)}
      ${membersSection}
      ${budgetPolicySection}
      ${workspaceAuditSection}
      <p class="wh-r4-route-kicker" data-r10-settings-diagnostics="true">${escapeHtml(goldPathCopyT(locale, "systemDiagnosticsForAdminsReadOnly"))}</p>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-settings-runtime="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "settings.runtime"))}</h3>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.runtimeStatus"))}</strong><span class="wh-pill">${escapeHtml(runtimeStatusLabel(props.runtimeStatus, locale))}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.worker"))}</strong><span class="wh-pill">${escapeHtml(String(props.workerCount))}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.broker"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.brokerConfigured, locale))}</span></div>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.database"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.databaseConfigured, locale))}</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-llm="true">
          <h3 role="heading" aria-level="2">${escapeHtml(routeT(locale, "settings.llm"))}</h3>
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.provider"))}</strong><span class="wh-pill">${escapeHtml(props.defaultProvider)}</span></div>
          <div role="listitem" class="wh-r4-route-row"><div><strong>${escapeHtml(routeT(locale, "settings.model"))}</strong><p>${escapeHtml(props.defaultModel)}</p></div><span class="wh-pill">${escapeHtml(String(props.providerCount))}</span></div>
          <div role="listitem" class="wh-r4-route-row" title="${escapeHtml(goldPathCopyT(locale, "serverSideKeyForTheAi"))}"><strong>${escapeHtml(routeT(locale, "settings.apiKey"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.apiKeyConfigured, locale))}</span></div>
          ${!props.apiKeyConfigured ? `<p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "aiEngineKeyNotSetAi"))}</p>` : ""}
          <div role="listitem" class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.baseUrl"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.baseUrlConfigured, locale))}</span></div>
          <p class="wh-subtle">${escapeHtml(goldPathCopyT(locale, "keysLiveOnlyInServerEnv"))}</p>
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
  | { key: "project-timeline"; timeline: ProjectTimelinePageVM }
  | { key: "intake"; session: SessionVM }
  | { key: "intake"; start: true; project?: { id: string; name: string } | undefined; projectUnavailable?: boolean | undefined; projects?: ProjectListVM | undefined }
  | { key: "approvals"; approvals: ApprovalCenterVM }
  | { key: "workitem"; workitem: WorkItemDetailVM }
  | { key: "proposal"; proposal: ProposalDetailVM; proposalConflicts?: ProposalConflict[] | undefined; proposalConflictsCheckFailed?: boolean | undefined }
  | { key: "conversation"; conversation: ConversationMirrorInput }
  | { key: "drive"; drive: DrivePageVM; projects?: ProjectListVM | undefined }
  | { key: "meetings"; meetings: MeetingPageVM; projects?: ProjectListVM | undefined }
  | { key: "notifications"; notifications: NotificationPageVM }
  | { key: "calendar"; calendar: CalendarPageVM }
  | { key: "health"; health: ProjectHealthPageVM }
  | { key: "replay"; replay: ReplayTraceVM }
  | { key: "cost"; cost: CostDashboardVM }
  | { key: "agents"; agents: AgentArmyDashboardVM }
  | { key: "knowledge"; evidence: EvidenceBubble; sourceRef?: string | undefined; scopeLanding?: boolean | undefined; projects?: ProjectListVM | undefined }
  | { key: "search"; q?: string | undefined }
  | { key: "skills"; skills: TeamSkillsPageVM; isAdmin?: boolean | undefined }
  | { key: "settings"; settings: SettingsPageVM; isAdmin?: boolean | undefined }
  | { key: "memory"; memory: { userMemories: UserMemoryManagementPageVM; teamSkills: TeamSkillManagementPageVM; tab: "profile" | "skills"; isAdmin: boolean } };

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
    case "project-timeline":
      return renderProjectTimelineRouteComponent(input.timeline, locale);
    case "intake":
      if ("start" in input) {
        return renderIntakeStartRouteComponent(locale, input.project, input.projectUnavailable, input.projects);
      }
      return renderIntakeRouteComponent(input.session, locale);
    case "approvals":
      return renderApprovalsRouteComponent(input.approvals, locale);
    case "workitem":
      return renderWorkItemRouteComponent(input.workitem, locale);
    case "proposal":
      return renderProposalRouteComponent(input.proposal, locale, input.proposalConflicts ?? [], input.proposalConflictsCheckFailed ?? false);
    case "conversation":
      return renderConversationRouteComponent(input.conversation, locale);
    case "drive":
      return renderDriveRouteComponent(input.drive, locale, input.projects);
    case "meetings":
      return renderMeetingRouteComponent(input.meetings, locale, input.projects);
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
      return renderKnowledgeRouteComponent(input.evidence, locale, input.sourceRef, input.scopeLanding, input.projects);
    case "search":
      return renderSearchRouteComponent(input.q, locale);
    case "skills":
      return renderTeamSkillsRouteComponent(input.skills, locale, input.isAdmin ?? false);
    case "settings":
      return renderSettingsRouteComponent(input.settings, locale, input.isAdmin ?? false);
    case "memory":
      return renderMemoryRouteComponent(input.memory, locale);
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
    proposal: renderProposalRouteComponent(vm.page_vms.proposal, locale, proposalConflictsFromSurface(routeSurface), routeSurface.proposal_conflicts_check_failed ?? false),
    replay: renderReplayRouteComponent(vm.page_vms.replay, locale),
    cost: renderCostRouteComponent(vm.page_vms.cost, locale),
    ...(routeSurface.knowledge_evidence ? { knowledge: renderKnowledgeRouteComponent(routeSurface.knowledge_evidence, locale) } : {}),
    ...(vm.page_vms.settings ? { settings: renderSettingsRouteComponent(vm.page_vms.settings, locale) } : {})
  };
}
