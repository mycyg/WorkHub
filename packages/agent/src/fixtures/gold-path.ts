import {
  agentRunSchema,
  agentStepSchema,
  approvalCenterVmSchema,
  attentionHomeVmSchema,
  attentionItemSchema,
  costDashboardVmSchema,
  costSummaryVmSchema,
  deliverableChangeManifestSchema,
  evidenceBubbleSchema,
  eventTypes,
  projectSchema,
  proposalDetailVmSchema,
  questionCardSchema,
  replayTraceVmSchema,
  snapshotSchema,
  workHubEventEnvelopeSchema,
  workHubEventSchema,
  workItemDetailVmSchema,
  workItemSchema,
  type AgentRun,
  type AgentStep,
  type ApprovalCenterVM,
  type ApprovalRequest,
  type AttentionHomeVM,
  type AttentionItem,
  type AuditLogFact,
  type CostDashboardVM,
  type CostSummaryVM,
  type CuuState,
  type DeliverableChangeManifest,
  type EvidenceBubble,
  type EvidenceRef,
  type ManifestFacts,
  type Project,
  type ProposalDetailVM,
  type QuestionCard,
  type ReplayTraceVM,
  type Snapshot,
  type WorkHubEvent,
  type WorkItem,
  type WorkItemDetailVM
} from "@workhub/contracts";
import { buildUsageRecord, usageToLedgerEntry, type CostLedgerEntry, type UsageRecord } from "@workhub/cost";
import { makeWorkHubEvent, topics } from "@workhub/events";
import { z } from "zod";

export const p05GoldPathFixtureId = "weekly_report_manifest_doc";

export const p05GoldPathIds = {
  workspace: "00000000-0000-4000-8000-000000000100",
  team: "00000000-0000-4000-8000-000000000101",
  user: "00000000-0000-4000-8000-000000000102",
  project: "00000000-0000-4000-8000-000000000103",
  workItem: "00000000-0000-4000-8000-000000000104",
  session: "00000000-0000-4000-8000-000000000105",
  branch: "00000000-0000-4000-8000-000000000106",
  run: "00000000-0000-4000-8000-000000000107",
  proposal: "00000000-0000-4000-8000-000000000108",
  baseSnapshot: "00000000-0000-4000-8000-000000000109",
  draftSnapshot: "00000000-0000-4000-8000-00000000010a",
  mergeSnapshot: "00000000-0000-4000-8000-00000000010b",
  evidenceMeeting: "00000000-0000-4000-8000-000000000201",
  evidenceDrive: "00000000-0000-4000-8000-000000000202",
  evidenceComment: "00000000-0000-4000-8000-000000000203",
  question: "00000000-0000-4000-8000-000000000301",
  evidenceBubble: "00000000-0000-4000-8000-000000000302",
  changeMarkdown: "00000000-0000-4000-8000-000000000401",
  changePreview: "00000000-0000-4000-8000-000000000402",
  auditSnapshot: "00000000-0000-4000-8000-000000000501",
  auditProposal: "00000000-0000-4000-8000-000000000502",
  auditReview: "00000000-0000-4000-8000-000000000503",
  auditMerge: "00000000-0000-4000-8000-000000000504",
  eventQuestion: "00000000-0000-4000-8000-000000000601",
  eventRunStarted: "00000000-0000-4000-8000-000000000602",
  eventReadMeeting: "00000000-0000-4000-8000-000000000603",
  eventEvidenceReady: "00000000-0000-4000-8000-000000000604",
  eventBudgetWarning: "00000000-0000-4000-8000-000000000605",
  eventWriteDeliverable: "00000000-0000-4000-8000-000000000606",
  eventSnapshot: "00000000-0000-4000-8000-000000000607",
  eventProposalOpened: "00000000-0000-4000-8000-000000000608",
  eventProposalMerged: "00000000-0000-4000-8000-000000000609",
  eventNotification: "00000000-0000-4000-8000-00000000060a",
  eventUsageRecorded: "00000000-0000-4000-8000-00000000060b",
  eventProposalReviewed: "00000000-0000-4000-8000-00000000060c",
  stepClarify: "00000000-0000-4000-8000-000000000701",
  stepReadMeeting: "00000000-0000-4000-8000-000000000702",
  stepReadDrive: "00000000-0000-4000-8000-000000000703",
  stepGroundEvidence: "00000000-0000-4000-8000-000000000704",
  stepWriteDeliverable: "00000000-0000-4000-8000-000000000705",
  stepOpenProposal: "00000000-0000-4000-8000-000000000706",
  comment: "00000000-0000-4000-8000-000000000801",
  approval: "00000000-0000-4000-8000-000000000802",
  eventApprovalAsk: "00000000-0000-4000-8000-000000000803",
  costLedger: "00000000-0000-4000-8000-000000000901"
} as const;

export type P05GoldPathFixture = {
  id: typeof p05GoldPathFixtureId;
  project: Project;
  workItem: WorkItem;
  question: QuestionCard;
  evidenceBubble: EvidenceBubble;
  manifest: DeliverableChangeManifest;
  workItemDetail: WorkItemDetailVM;
  proposalDetail: ProposalDetailVM;
  approvalCenter: ApprovalCenterVM;
  replay: ReplayTraceVM;
  costSummary: CostSummaryVM;
  costDashboard: CostDashboardVM;
  usageRecord: UsageRecord;
  ledgerEntry: CostLedgerEntry;
  events: WorkHubEvent<unknown>[];
  attentionHome: AttentionHomeVM;
  evidenceSourceIds: string[];
  evalGate: {
    fixture: "weekly_report_manifest_doc" | "budget_threshold_warning";
    minReplaySteps: number;
    requiredCuuStates: CuuState[];
    warningRatioThreshold: number;
  };
};

const at = (minutes: number) => new Date(Date.UTC(2026, 5, 5, 1, minutes, 0)).toISOString();
const sha = (char: string) => char.repeat(64);

const actor = {
  actor_kind: "ai",
  label: "Cuu"
} as const;

const humanActor = {
  actor_kind: "human",
  actor_user_id: p05GoldPathIds.user,
  label: "客户成功负责人"
} as const;

const meetingEvidence: EvidenceRef = {
  id: p05GoldPathIds.evidenceMeeting,
  source_type: "meeting",
  source_id: "meeting-weekly-sync-2026-06-01",
  title: "上次周会纪要",
  excerpt: "客户希望周报先看阻塞和下周动作，再看数据明细。",
  locator: { timestamp_s: 840 },
  confidence_hint: "found",
  href: "/api/evidence/meeting-weekly-sync-2026-06-01"
};

const driveEvidence: EvidenceRef = {
  id: p05GoldPathIds.evidenceDrive,
  source_type: "drive_file",
  source_id: "drive:/客户成功/数据汇总.xlsx",
  title: "项目网盘 / 数据汇总.xlsx",
  excerpt: "包含活跃客户数、风险客户数、续约推进和跟进人。",
  locator: { sheet: "summary", cell_range: "A1:H32" },
  confidence_hint: "found",
  href: "/api/evidence/drive-data-summary"
};

const commentEvidence: EvidenceRef = {
  id: p05GoldPathIds.evidenceComment,
  source_type: "comment",
  source_id: "comment:format-like-daily",
  title: "客户希望格式更像日报",
  excerpt: "模板请短一点，最好每段都能直接复制到日报里。",
  confidence_hint: "found",
  href: "/api/evidence/comment-format-like-daily"
};

const evidenceRefs = [meetingEvidence, driveEvidence, commentEvidence];

const project: Project = {
  id: p05GoldPathIds.project,
  workspace_id: p05GoldPathIds.workspace,
  name: "客户成功周报",
  slug: "customer-success-weekly",
  description: "P0.5 黄金路径项目，用于验证选项澄清、证据、交付物和回放。",
  owner_nickname: "客户成功负责人",
  owner_user_id: p05GoldPathIds.user,
  archived: false,
  next_seq: 2,
  created_at: at(0),
  updated_at: at(8)
};

const workItem: WorkItem = {
  id: p05GoldPathIds.workItem,
  code: "CSW-1",
  project_id: p05GoldPathIds.project,
  workspace_id: p05GoldPathIds.workspace,
  submitter_user_id: p05GoldPathIds.user,
  title: "生成客户周报模板",
  raw_description: "帮我整理一个客户周报模板，用上上次会议和项目网盘里的数据。",
  summary_md: "生成一份可审批的客户周报 Markdown 模板，并附 HTML 预览。",
  status: "in_review",
  priority: "normal",
  estimate_hours: 0.5,
  estimate_confidence: "medium",
  planning_note: "优先点选澄清，证据必须来自会议、网盘和评论三类来源。",
  start_at: at(1),
  due_at: at(240),
  sync_state: "pending",
  version: 3,
  mode: "worker",
  human_reserved: false,
  main_branch_id: p05GoldPathIds.branch,
  created_at: at(1),
  updated_at: at(10)
};

const question: QuestionCard = {
  id: p05GoldPathIds.question,
  session_id: p05GoldPathIds.session,
  work_item_id: p05GoldPathIds.workItem,
  title: "这份周报模板先按哪个口径做？",
  body: "我会用会议纪要和网盘数据起草，先选一个最接近的方向。",
  input_mode: "single_choice",
  options: [
    {
      id: "risk-first",
      label: "风险优先",
      description: "先列阻塞客户和需要你拍板的事项。",
      impact: "更适合发给管理者快速看重点。",
      risk_hint: "low",
      icon: "alert-circle"
    },
    {
      id: "progress-first",
      label: "进展优先",
      description: "先列本周完成、下周计划，再补风险。",
      impact: "更适合团队日常同步。",
      risk_hint: "low",
      icon: "list-checks"
    },
    {
      id: "data-first",
      label: "数据优先",
      description: "先放核心指标和趋势，再补文字说明。",
      impact: "更适合经营复盘，但需要更多数据校验。",
      risk_hint: "medium",
      icon: "bar-chart"
    }
  ],
  recommended_option_ids: ["risk-first"],
  free_text: {
    enabled: true,
    collapsed_by_default: true,
    placeholder: "有特殊格式再补一句，不填也可以。",
    max_length: 300
  },
  progress: [
    { key: "intent", label: "需求", state: "done" },
    { key: "scope", label: "口径", state: "active" },
    { key: "draft", label: "草稿", state: "pending" },
    { key: "review", label: "审批", state: "pending" }
  ],
  evidence_refs: [meetingEvidence],
  submit: {
    method: "POST",
    href: `/api/sessions/${p05GoldPathIds.session}/next-question`
  }
};

const evidenceBubble: EvidenceBubble = {
  id: p05GoldPathIds.evidenceBubble,
  query_text: "客户成功周报模板 会议纪要 网盘数据",
  summary_text: "我找到了会议口径、网盘数据和客户格式偏好，足够起草第一版。",
  evidence_refs: evidenceRefs,
  actions: [
    {
      id: "use_for_current_task",
      label: "用这些证据继续",
      method: "POST",
      href: `/api/workitems/${p05GoldPathIds.workItem}/evidence-bindings`
    },
    { id: "open_full_search", label: "打开完整检索", href: "/knowledge/search?run=weekly-report" },
    { id: "ask_followup", label: "再问一个范围问题", href: `/intake/${p05GoldPathIds.session}` }
  ]
};

const budgetNotice = {
  code: "budget_warning",
  severity: "warning",
  message: "本次运行已接近单次预算上限，我会保留回放并优先使用便宜模型继续。",
  scope: { kind: "workitem", workitem_id: p05GoldPathIds.workItem },
  usage_ratio: 0.84,
  recommended_action: "downgrade_model",
  options: [
    {
      id: "continue_low_cost",
      label: "继续但降级模型",
      action_href: `/api/workitems/${p05GoldPathIds.workItem}/agent-runs`
    },
    {
      id: "open_cost",
      label: "查看预算",
      action_href: `/dashboard/cost?workItemId=${p05GoldPathIds.workItem}`
    }
  ],
  action_href: `/dashboard/cost?workItemId=${p05GoldPathIds.workItem}`
} satisfies CostSummaryVM["active_notices"][number];

const workItemBudgetUsage: CostSummaryVM["scopes"][number] = {
  scope: { kind: "workitem", workitem_id: p05GoldPathIds.workItem },
  scope_label: "生成客户周报模板",
  policy_id: "pcost-workitem-run-v0",
  period: "run",
  period_start: at(2),
  period_end: at(8),
  token_in: 80000,
  token_out: 24000,
  total_tokens: 104000,
  max_tokens: 120000,
  remaining_tokens: 16000,
  estimated_cost_cny: "4.2",
  max_cost_cny: "5",
  remaining_cost_cny: "0.8",
  warning_ratio: 0.84,
  status: "warning"
};

const userBudgetUsage: CostSummaryVM["me"] = {
  scope: { kind: "user", user_id: p05GoldPathIds.user },
  scope_label: "我的今日 AI 预算",
  policy_id: "pcost-user-day-v0",
  period: "day",
  period_start: at(0),
  period_end: at(1440),
  token_in: 80000,
  token_out: 24000,
  total_tokens: 104000,
  max_tokens: 500000,
  remaining_tokens: 396000,
  estimated_cost_cny: "4.2",
  max_cost_cny: "20",
  remaining_cost_cny: "15.8",
  warning_ratio: 0.21,
  status: "ok"
};

const teamBudgetUsage: NonNullable<CostSummaryVM["team"]> = {
  scope: { kind: "team", team_id: p05GoldPathIds.team },
  scope_label: "团队今日 AI 预算",
  policy_id: "pcost-team-day-v0",
  period: "day",
  period_start: at(0),
  period_end: at(1440),
  token_in: 80000,
  token_out: 24000,
  total_tokens: 104000,
  max_tokens: 5000000,
  remaining_tokens: 4896000,
  estimated_cost_cny: "4.2",
  max_cost_cny: "200",
  remaining_cost_cny: "195.8",
  warning_ratio: 0.021,
  status: "ok"
};

const costSummary: CostSummaryVM = {
  me: userBudgetUsage,
  team: teamBudgetUsage,
  scopes: [workItemBudgetUsage, userBudgetUsage, teamBudgetUsage],
  active_notices: [budgetNotice],
  generated_at: at(8)
};

const usageRecord = buildUsageRecord({
  runId: p05GoldPathIds.run,
  workItemId: p05GoldPathIds.workItem,
  userId: p05GoldPathIds.user,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  task: "weekly_report_manifest_doc",
  actorId: "cuu",
  inputTokens: 80000,
  outputTokens: 24000,
  source: "agent_step",
  costTier: {
    inputCnyPerMtok: 15,
    outputCnyPerMtok: 125
  },
  createdAt: new Date(at(7))
});

const ledgerEntry = usageToLedgerEntry(
  usageRecord,
  { kind: "workitem", workitemId: p05GoldPathIds.workItem },
  { id: p05GoldPathIds.costLedger, teamId: p05GoldPathIds.team }
);

const manifest: DeliverableChangeManifest = {
  version: 0,
  proposal_id: p05GoldPathIds.proposal,
  work_item_id: p05GoldPathIds.workItem,
  branch_id: p05GoldPathIds.branch,
  title: "生成客户周报模板",
  summary_md: [
    "## 变更摘要",
    "",
    "- 新增 `weekly-report-template.md`，按风险优先口径组织周报。",
    "- 新增 `preview.html`，用于 Web/Tauri 预览同一份交付内容。",
    "- 证据来自会议纪要、网盘数据和客户评论；没有使用未确认来源。",
    "",
    "## 审核建议",
    "",
    "建议先采纳第一版；若要打回，请填写原因，下一轮 Agent 会把原因放入上下文。"
  ].join("\n"),
  author: {
    actor_kind: "ai",
    label: "Cuu"
  },
  base: {
    snapshot_id: p05GoldPathIds.baseSnapshot,
    branch_head_ref: "workhub://branches/customer-success-weekly@base",
    created_at: at(6)
  },
  changes: [
    {
      id: p05GoldPathIds.changeMarkdown,
      target_kind: "text_doc",
      target_ref: {
        entity_type: "delivery",
        path: "/outputs/weekly-report-template.md",
        sha256_after: sha("b")
      },
      change_type: "generated",
      human_summary: "生成 Markdown 周报模板，包含风险、进展、数据和下周动作四段。",
      machine_summary: {
        after_excerpt: "## 客户成功周报\n\n### 本周风险\n- ...",
        changed_fields: ["title", "risk_section", "metrics_section", "next_actions"]
      },
      preview_ref: {
        kind: "text",
        href: "/api/previews/weekly-report-template.md"
      },
      evidence_refs: evidenceRefs
    },
    {
      id: p05GoldPathIds.changePreview,
      target_kind: "text_doc",
      target_ref: {
        entity_type: "delivery",
        path: "/outputs/preview.html",
        sha256_after: sha("c")
      },
      change_type: "generated",
      human_summary: "生成 HTML 预览，方便 Web 与桌面客户端展示同一交付物。",
      preview_ref: {
        kind: "text",
        href: "/api/previews/weekly-report-preview.html"
      },
      evidence_refs: evidenceRefs
    }
  ],
  checks: [
    {
      id: "snapshot_exists",
      label: "执行前快照存在",
      status: "passed",
      detail: "已记录 base snapshot，可用于回滚。"
    },
    {
      id: "artifact_exists",
      label: "交付物已生成",
      status: "passed",
      detail: "Markdown 与 HTML 预览均已生成。"
    },
    {
      id: "evidence_linked",
      label: "证据已绑定",
      status: "passed",
      detail: "3 条证据均来自 fixture 白名单。",
      evidence_refs: evidenceRefs
    },
    {
      id: "revert_available",
      label: "回滚可用",
      status: "passed",
      detail: "可恢复到执行前快照。"
    },
    {
      id: "budget_warning",
      label: "预算接近上限",
      status: "warning",
      detail: "当前使用约 84% 单次预算，已发 budget.warning。"
    }
  ],
  evidence_refs: evidenceRefs,
  risk: {
    level: "low",
    human_label: "只生成文档草稿和预览，不触发外部发送，可回滚。",
    reversible: true
  },
  rollback: {
    available: true,
    snapshot_id: p05GoldPathIds.baseSnapshot,
    description: "撤回本次 Proposal 后，恢复到生成前的 delivery snapshot。"
  },
  review: {
    suggested_decision: "needs_human",
    reason_required_on_reject: true
  }
};

const run: AgentRun = {
  id: p05GoldPathIds.run,
  work_item_id: p05GoldPathIds.workItem,
  branch_id: p05GoldPathIds.branch,
  mode: "worker",
  actor: "cuu",
  status: "succeeded",
  model: "deepseek-v4-flash",
  turns_used: 6,
  max_turns: 15,
  seconds: 42,
  token_in: 80000,
  token_out: 24000,
  cost_estimate: usageRecord.estimatedCostCny,
  outcome_reason: "proposal_opened",
  handoff_md: "已生成周报模板与 HTML 预览，等待用户审批。",
  started_at: at(2),
  finished_at: at(8),
  created_at: at(2),
  updated_at: at(8)
};

const steps: AgentStep[] = [
  {
    id: p05GoldPathIds.stepClarify,
    agent_run_id: p05GoldPathIds.run,
    step_no: 1,
    phase: "think",
    input_json: { selected_option_id: "risk-first" },
    output_excerpt: "用户选择风险优先口径，进入文档草稿路径。",
    control_signal: "continue",
    created_at: at(2)
  },
  {
    id: p05GoldPathIds.stepReadMeeting,
    agent_run_id: p05GoldPathIds.run,
    step_no: 2,
    phase: "tool_call",
    tool_name: "meeting.search",
    input_json: { query: "客户成功周报 上次周会纪要" },
    output_excerpt: "读取到会议纪要：先看阻塞和下周动作。",
    control_signal: "continue",
    created_at: at(3)
  },
  {
    id: p05GoldPathIds.stepReadDrive,
    agent_run_id: p05GoldPathIds.run,
    step_no: 3,
    phase: "tool_call",
    tool_name: "drive.read",
    input_json: { path: "/客户成功/数据汇总.xlsx", sheet: "summary" },
    output_excerpt: "读取到活跃客户、风险客户、续约推进等周报指标。",
    control_signal: "continue",
    created_at: at(4)
  },
  {
    id: p05GoldPathIds.stepGroundEvidence,
    agent_run_id: p05GoldPathIds.run,
    step_no: 4,
    phase: "tool_result",
    tool_name: "knowledge.ground",
    input_json: {
      evidence_ids: evidenceRefs.map((evidence) => evidence.id)
    },
    output_excerpt: "证据已绑定到会议、网盘和评论三类来源，没有缺失证据。",
    control_signal: "continue",
    created_at: at(5)
  },
  {
    id: p05GoldPathIds.stepWriteDeliverable,
    agent_run_id: p05GoldPathIds.run,
    step_no: 5,
    phase: "tool_call",
    tool_name: "sandbox.write_file",
    input_json: {
      files: ["/outputs/weekly-report-template.md", "/outputs/preview.html"]
    },
    output_excerpt: "写入周报模板与 HTML 预览，并记录草稿快照。",
    control_signal: "continue",
    snapshot_id: p05GoldPathIds.draftSnapshot,
    created_at: at(6)
  },
  {
    id: p05GoldPathIds.stepOpenProposal,
    agent_run_id: p05GoldPathIds.run,
    step_no: 6,
    phase: "final",
    input_json: { proposal_id: p05GoldPathIds.proposal },
    output_excerpt: "生成 DeliverableChangeManifest，打开待审批 Proposal。",
    control_signal: "stop",
    snapshot_id: p05GoldPathIds.draftSnapshot,
    created_at: at(7)
  }
];

const snapshots: Snapshot[] = [
  {
    id: p05GoldPathIds.baseSnapshot,
    work_item_id: p05GoldPathIds.workItem,
    branch_id: p05GoldPathIds.branch,
    kind: "pre_step",
    ref: "snapshots/csw-1/base",
    content_sha256: sha("d"),
    created_by_kind: "system",
    created_at: at(2)
  },
  {
    id: p05GoldPathIds.draftSnapshot,
    work_item_id: p05GoldPathIds.workItem,
    branch_id: p05GoldPathIds.branch,
    kind: "pre_step",
    ref: "snapshots/csw-1/draft",
    content_sha256: sha("e"),
    created_by_kind: "ai",
    created_at: at(6)
  },
  {
    id: p05GoldPathIds.mergeSnapshot,
    work_item_id: p05GoldPathIds.workItem,
    branch_id: p05GoldPathIds.branch,
    kind: "merge",
    ref: "snapshots/csw-1/merge",
    content_sha256: sha("f"),
    created_by_kind: "system",
    created_at: at(10)
  }
];

const auditLogs: AuditLogFact[] = [
  {
    id: p05GoldPathIds.auditSnapshot,
    workspace_id: p05GoldPathIds.workspace,
    actor: { actor_kind: "system", actor_nickname: "snapshot-service" },
    entity: { entity_type: "agent_run", entity_id: p05GoldPathIds.run },
    action: "snapshot.created",
    detail_json: { snapshot_id: p05GoldPathIds.draftSnapshot, ref: "snapshots/csw-1/draft" },
    snapshot_id: p05GoldPathIds.draftSnapshot,
    created_at: at(6)
  },
  {
    id: p05GoldPathIds.auditProposal,
    workspace_id: p05GoldPathIds.workspace,
    actor: { actor_kind: "ai", actor_nickname: "Cuu" },
    entity: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
    action: "proposal.opened",
    detail_json: { manifest_version: 0, changes: manifest.changes.length },
    snapshot_id: p05GoldPathIds.draftSnapshot,
    created_at: at(7)
  }
];

const manifestFacts: ManifestFacts = {
  checks: {
    snapshot_exists: "passed",
    revert_available: "passed",
    ask_gate_required: "passed"
  },
  rollback: manifest.rollback,
  risk: {
    reversible: manifest.risk.reversible,
    irreversible_reasons: []
  },
  evidence_refs: [
    {
      source_type: "agent_step",
      source_id: p05GoldPathIds.stepWriteDeliverable,
      title: "写入交付物前后均有快照"
    },
    {
      source_type: "audit_log",
      source_id: p05GoldPathIds.auditProposal,
      title: "这次变更申请已记入审计"
    }
  ]
};

const proposalAttention: AttentionItem = {
  id: p05GoldPathIds.eventProposalOpened,
  kind: "proposal_review",
  priority: "normal",
  work_item_id: p05GoldPathIds.workItem,
  project_id: p05GoldPathIds.project,
  source_ref: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
  title: "Cuu 写好了客户周报模板",
  summary_text: "请看一下这份非代码变更申请：2 个交付物、3 条证据、可回滚。",
  reason_text: "需要你决定采纳还是打回。",
  evidence_refs: evidenceRefs,
  actions: [
    {
      id: "open",
      label: "查看变更",
      style: "primary",
      method: "GET",
      href: `/proposals/${p05GoldPathIds.proposal}`
    },
    {
      id: "request_changes",
      label: "打回",
      style: "secondary",
      method: "POST",
      href: `/api/proposals/${p05GoldPathIds.proposal}/review`,
      requires_reason: true
    }
  ],
  cuu_state: "carrying_document",
  created_at: at(7)
};

const approvalRequest: ApprovalRequest = {
  id: p05GoldPathIds.approval,
  work_item_id: p05GoldPathIds.workItem,
  agent_run_id: p05GoldPathIds.run,
  action_pattern: "proposal.review.weekly_report_template",
  payload_json: {
    ui: {
      summary_text: "Cuu 准备把客户周报模板提交给正式交付，需要你点头。",
      reason_text: "这次会把 2 个交付物放入可采纳的变更包；如果打回，理由会回灌给 Cuu 继续改。",
      risk: {
        level: "low",
        human_label: "只生成文档草稿和预览，不会对外发送，且有回滚点。"
      },
      evidence_refs: evidenceRefs,
      affected_targets: manifest.changes.map((change) => change.target_ref.path ?? change.target_kind),
      requires_desktop: false
    },
    raw_args: {
      proposal_id: p05GoldPathIds.proposal,
      work_item_id: p05GoldPathIds.workItem,
      action: "review_deliverable_change_manifest"
    }
  },
  status: "pending",
  routed_to_user_id: p05GoldPathIds.user,
  sla_due_at: at(90),
  created_at: at(8),
  updated_at: at(8)
};

const approvalAttention: AttentionItem = {
  id: p05GoldPathIds.approval,
  kind: "approval",
  priority: "high",
  work_item_id: p05GoldPathIds.workItem,
  project_id: p05GoldPathIds.project,
  source_ref: {
    entity_type: "approval_request",
    entity_id: p05GoldPathIds.approval
  },
  title: "Cuu 等你审批《客户周报模板》",
  summary_text: "2 个交付物、3 条证据、可回滚；点同意后才会进入正式交付。",
  reason_text: "打回时请写明原因，Cuu 会带着它继续改。",
  evidence_refs: evidenceRefs,
  actions: [
    {
      id: "open_approval",
      label: "打开审批",
      style: "primary",
      method: "GET",
      href: "/approvals"
    },
    {
      id: "approve",
      label: "通过",
      style: "secondary",
      method: "POST",
      href: `/api/approvals/${p05GoldPathIds.approval}/respond`
    },
    {
      id: "deny",
      label: "打回",
      style: "danger",
      method: "POST",
      href: `/api/approvals/${p05GoldPathIds.approval}/respond`,
      requires_reason: true
    }
  ],
  cuu_state: "asking_approval",
  created_at: at(8),
  expires_at: at(90)
};

const clarificationAttention: AttentionItem = {
  id: p05GoldPathIds.eventQuestion,
  kind: "clarification",
  priority: "normal",
  work_item_id: p05GoldPathIds.workItem,
  project_id: p05GoldPathIds.project,
  source_ref: { entity_type: "approval_request", entity_id: p05GoldPathIds.question },
  title: question.title,
  summary_text: "先点一个周报口径，我再开始做。",
  actions: [
    {
      id: "answer",
      label: "选择口径",
      style: "primary",
      method: "GET",
      href: `/intake/${p05GoldPathIds.session}`
    }
  ],
  cuu_state: "asking_approval",
  created_at: at(1)
};

const deliveryAttention: AttentionItem = {
  id: p05GoldPathIds.eventProposalMerged,
  kind: "delivery_ready",
  priority: "normal",
  work_item_id: p05GoldPathIds.workItem,
  project_id: p05GoldPathIds.project,
  source_ref: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
  title: "客户周报模板已采纳",
  summary_text: "我已经合并交付物，并留下了审计和回滚入口。",
  actions: [
    {
      id: "open_delivery",
      label: "查看交付物",
      style: "primary",
      method: "GET",
      href: `/workitems/${p05GoldPathIds.workItem}`
    },
    {
      id: "open_replay",
      label: "查看回放",
      style: "secondary",
      method: "GET",
      href: `/agent-runs/${p05GoldPathIds.run}/replay`
    }
  ],
  cuu_state: "celebrating",
  created_at: at(10)
};

const proposalDetail: ProposalDetailVM = {
  proposal_id: p05GoldPathIds.proposal,
  work_item_id: p05GoldPathIds.workItem,
  title: "生成客户周报模板",
  status: "opened",
  manifest,
  evidence_refs: evidenceRefs,
  review_actions: {
    approve: {
      id: "approve",
      label: "采纳",
      method: "POST",
      href: `/api/proposals/${p05GoldPathIds.proposal}/review`
    },
    request_changes: {
      id: "request_changes",
      label: "打回并说明原因",
      method: "POST",
      href: `/api/proposals/${p05GoldPathIds.proposal}/review`,
      requires_reason: true
    },
    merge: {
      id: "merge",
      label: "合并交付物",
      method: "POST",
      href: `/api/proposals/${p05GoldPathIds.proposal}/merge`
    }
  },
  comments: [
    {
      id: p05GoldPathIds.comment,
      author_label: "Cuu",
      body: "我把变更说明写成 PR 样式，用户只需要采纳或打回。",
      created_at: at(7)
    }
  ]
};

const approvalCenter: ApprovalCenterVM = {
  items: [approvalAttention],
  requests: [approvalRequest],
  decided: [],
  filters: {
    pending: true,
    kind: "proposal",
    view: "one_thing"
  },
  counts: {
    pending: 1,
    all: 1,
    urgent: 0
  },
  // W2 inc3：逐项详情——交付物类审批，join 出 diff/合规检查 + 合成时间线 + 一条讨论。
  items_detail: {
    [p05GoldPathIds.approval]: {
      kind: "deliverable",
      proposal_id: p05GoldPathIds.proposal,
      proposal_href: `/proposals/${p05GoldPathIds.proposal}`,
      ai_reason: manifest.summary_md,
      risk_label: manifest.risk.human_label,
      manifest_changes: manifest.changes,
      checks: manifest.checks,
      conflicts: manifest.checks
        .filter((check) => check.status === "failed" || check.status === "warning")
        .map((check) => ({ description: check.label, ...(check.detail ? { impact: check.detail } : {}) })),
      affected_targets: [],
      timeline: [
        { id: `${p05GoldPathIds.approval}:created`, kind: "created", label: "发起申请", status: "done", at: at(8) },
        { id: `${p05GoldPathIds.approval}:routed`, kind: "routed", label: "路由审批", status: "current", actor_label: "你", sla_due_at: at(90) },
        { id: `${p05GoldPathIds.approval}:decided`, kind: "decided", label: "待决策", status: "pending" }
      ],
      comments: [
        {
          id: "20000000-0000-4000-8000-0000000000f1",
          author_label: "李梅",
          body: "建议错峰执行，避免和渠道推广预算撞车。",
          created_at: at(4)
        }
      ]
    }
  }
};

const workItemDetail: WorkItemDetailVM = {
  workitem: workItem,
  approval_decisions: [],
  acceptance: [
    {
      id: "scope-confirmed",
      title: "复盘口径已确认",
      status: "met"
    },
    {
      id: "changes-reviewable",
      title: "每处改动都能单独查看",
      status: "met"
    },
    {
      id: "cost-visible",
      title: "这次花了多少一目了然",
      status: "met"
    }
  ],
  agent_trace_preview: steps.slice(0, 5),
  latest_proposal: manifest,
  accepted_deliverables: [],
  evidence_refs: evidenceRefs,
  actions: {}
};

const replay: ReplayTraceVM = {
  run,
  steps,
  evidence_refs: evidenceRefs,
  snapshots,
  audit_logs: auditLogs,
  accepted_deliverables: [],
  merge_timeline: [],
  manifest_facts: manifestFacts,
  cost: costSummary
};

const costDashboard: CostDashboardVM = {
  generated_at: at(8),
  currency: "CNY",
  total_cost_cny: usageRecord.estimatedCostCny,
  token_in: usageRecord.inputTokens,
  token_out: usageRecord.outputTokens,
  unit_cost_cny: "4.2",
  trend: [
    { date: "2026-06-05", cost_cny: usageRecord.estimatedCostCny, tokens: 104000 }
  ],
  by_user: [
    {
      user_id: p05GoldPathIds.user,
      label: "客户成功负责人",
      cost_cny: usageRecord.estimatedCostCny,
      tokens: 104000
    }
  ],
  by_team: [
    {
      team_id: p05GoldPathIds.team,
      label: "客户成功团队",
      cost_cny: usageRecord.estimatedCostCny,
      tokens: 104000
    }
  ],
  by_workitem: [
    {
      workitem_id: p05GoldPathIds.workItem,
      code: workItem.code,
      cost_cny: usageRecord.estimatedCostCny,
      turns: run.turns_used
    }
  ],
  by_task_plan: [],
  by_objective: [],
  // R13 批 P4（labor-split 按 assignee 记账）：新增必填字段（zod `.default([])`→z.infer 输出非可选），
  // 这份手写字面量 fixture 不经 parseOutputContract 补默认值，必须显式给上，否则整个 gold-path 契约门失守。
  by_assignee: [],
  model_breakdown: [
    {
      provider: usageRecord.provider,
      model: usageRecord.model,
      count: 1,
      cost_cny: usageRecord.estimatedCostCny
    }
  ],
  budget: costSummary.scopes,
  notices: [budgetNotice],
  top_exhaustion_risks: [
    {
      scope: workItemBudgetUsage.scope,
      label: workItemBudgetUsage.scope_label,
      remaining_cost_cny: workItemBudgetUsage.remaining_cost_cny,
      status: workItemBudgetUsage.status
    }
  ]
};

const events: WorkHubEvent<unknown>[] = [
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventQuestion,
    type: eventTypes.permissionAsk,
    topic: topics.session(p05GoldPathIds.session).topic,
    ts: new Date(at(1)),
    actor: humanActor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    session_id: p05GoldPathIds.session,
    preview_text: "先点一个周报口径，我再开始做。",
    attention: clarificationAttention,
    data: question
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventRunStarted,
    type: eventTypes.agentRunStarted,
    topic: topics.run(p05GoldPathIds.run).topic,
    ts: new Date(at(2)),
    actor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    preview_text: "Cuu 开始整理客户周报模板。",
    data: run
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventReadMeeting,
    type: eventTypes.agentRunStep,
    topic: topics.run(p05GoldPathIds.run).topic,
    ts: new Date(at(3)),
    actor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    preview_text: "读取会议纪要，提取周报口径。",
    data: steps[1]
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventEvidenceReady,
    type: eventTypes.knowledgeEvidenceReady,
    topic: topics.session(p05GoldPathIds.session).topic,
    ts: new Date(at(5)),
    actor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    session_id: p05GoldPathIds.session,
    run_id: p05GoldPathIds.run,
    preview_text: evidenceBubble.summary_text,
    data: evidenceBubble
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventBudgetWarning,
    type: eventTypes.budgetWarning,
    topic: topics.user(p05GoldPathIds.user).topic,
    ts: new Date(at(5)),
    actor: { actor_kind: "system", label: "cost-governance" },
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    preview_text: budgetNotice.message,
    data: budgetNotice
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventWriteDeliverable,
    type: eventTypes.agentRunStep,
    topic: topics.run(p05GoldPathIds.run).topic,
    ts: new Date(at(6)),
    actor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    preview_text: "写入周报模板和 HTML 预览。",
    data: steps[4]
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventSnapshot,
    type: eventTypes.stepSnapshot,
    topic: topics.run(p05GoldPathIds.run).topic,
    ts: new Date(at(6)),
    actor: { actor_kind: "system", label: "snapshot-service" },
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    preview_text: "已创建交付物草稿快照。",
    data: snapshots[1]
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventProposalOpened,
    type: eventTypes.proposalOpened,
    topic: topics.workitem(p05GoldPathIds.workItem).topic,
    ts: new Date(at(7)),
    actor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    proposal_id: p05GoldPathIds.proposal,
    preview_text: "Cuu 写好了客户周报模板，请审批。",
    attention: proposalAttention,
    data: manifest
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventApprovalAsk,
    type: eventTypes.permissionAsk,
    topic: topics.user(p05GoldPathIds.user).topic,
    ts: new Date(at(8)),
    actor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    proposal_id: p05GoldPathIds.proposal,
    preview_text: "Cuu 准备提交客户周报模板，等你点头。",
    attention: approvalAttention,
    data: approvalRequest
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventUsageRecorded,
    type: eventTypes.usageRecorded,
    topic: topics.run(p05GoldPathIds.run).topic,
    ts: new Date(at(7)),
    actor: { actor_kind: "system", label: "cost-ledger" },
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    run_id: p05GoldPathIds.run,
    preview_text: "已记录本次 AgentRun 成本。",
    data: usageRecord
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventProposalMerged,
    type: eventTypes.proposalMerged,
    topic: topics.workitem(p05GoldPathIds.workItem).topic,
    ts: new Date(at(10)),
    actor: humanActor,
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    proposal_id: p05GoldPathIds.proposal,
    preview_text: "客户周报模板已采纳。",
    attention: deliveryAttention,
    data: {
      proposal_id: p05GoldPathIds.proposal,
      merge_snapshot_id: p05GoldPathIds.mergeSnapshot,
      rollback_available: true
    }
  }),
  makeWorkHubEvent({
    event_id: p05GoldPathIds.eventNotification,
    type: eventTypes.notificationCreated,
    topic: topics.user(p05GoldPathIds.user).topic,
    ts: new Date(at(10)),
    actor: { actor_kind: "system", label: "notification-service" },
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    preview_text: "客户周报模板已采纳进正式版，审计和还原入口可用。",
    attention: deliveryAttention,
    data: deliveryAttention
  })
];

const attentionHome: AttentionHomeVM = {
  primary: approvalAttention,
  queue: [clarificationAttention, proposalAttention, deliveryAttention],
  background_runs: [
    {
      run_id: p05GoldPathIds.run,
      work_item_id: p05GoldPathIds.workItem,
      title: "客户周报模板",
      state: "waiting_for_user",
      preview_text: "交付物已生成，等待审批。"
    }
  ],
  cuu_state: "carrying_document"
};

export function createP05GoldPathFixture(): P05GoldPathFixture {
  return {
    id: p05GoldPathFixtureId,
    project,
    workItem,
    question,
    evidenceBubble,
    manifest,
    workItemDetail,
    proposalDetail,
    approvalCenter,
    replay,
    costSummary,
    costDashboard,
    usageRecord,
    ledgerEntry,
    events,
    attentionHome,
    evidenceSourceIds: evidenceRefs.map((evidence) => evidence.source_id),
    evalGate: {
      fixture: "weekly_report_manifest_doc",
      minReplaySteps: 5,
      requiredCuuStates: [
        "asking_approval",
        "thinking",
        "searching_evidence",
        "carrying_document",
        "celebrating"
      ],
      warningRatioThreshold: 0.8
    }
  };
}

export function validateP05GoldPathFixture(fixture: P05GoldPathFixture = createP05GoldPathFixture()) {
  projectSchema.parse(fixture.project);
  workItemSchema.parse(fixture.workItem);
  questionCardSchema.parse(fixture.question);
  evidenceBubbleSchema.parse(fixture.evidenceBubble);
  deliverableChangeManifestSchema.parse(fixture.manifest);
  workItemDetailVmSchema.parse(fixture.workItemDetail);
  proposalDetailVmSchema.parse(fixture.proposalDetail);
  approvalCenterVmSchema.parse(fixture.approvalCenter);
  replayTraceVmSchema.parse(fixture.replay);
  costSummaryVmSchema.parse(fixture.costSummary);
  costDashboardVmSchema.parse(fixture.costDashboard);
  attentionHomeVmSchema.parse(fixture.attentionHome);

  for (const step of fixture.replay.steps) {
    agentStepSchema.parse(step);
  }
  for (const snapshot of fixture.replay.snapshots) {
    snapshotSchema.parse(snapshot);
  }
  for (const event of fixture.events) {
    workHubEventEnvelopeSchema.parse(event);
    workHubEventSchema(z.unknown()).parse(event);
    if (event.attention) {
      attentionItemSchema.parse(event.attention);
    }
  }

  agentRunSchema.parse(fixture.replay.run);
  return fixture;
}
