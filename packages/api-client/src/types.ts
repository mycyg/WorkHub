import type {
  AgentArmyDashboardVM,
  ApprovalCenterVM,
  AgentRunLiveVM,
  AgentStep,
  AcceptedDeliverableRestoreResult,
  AttentionHomeVM,
  // R20 R19-27（工作项跨 run 审计时间线）：GET /api/workitems/:id/audit 的响应契约。
  AuditTimelineVM,
  BudgetPolicy,
  BudgetPolicyUpdate,
  BootstrapProjectRequest,
  BootstrapProjectResult,
  // R23 P4（R20 P2A 端点上界面）：指派/认领、工作项评论、项目归档/软删、工作区审计流的请求与响应契约。
  AssignWorkItemRequest,
  AssignWorkItemResult,
  ClaimWorkItemResult,
  CreateWorkItemCommentRequest,
  WorkItemComment,
  WorkItemCommentsResult,
  ArchiveProjectResult,
  DeleteProjectResult,
  WorkspaceAuditListVM,
  WorkspaceAuditQuery,
  ClientDeviceRegisterRequest,
  ClientDeviceRegisterResponse,
  ClientDeviceResponse,
  DesktopBootstrapRequest,
  DesktopBootstrapResponse,
  CostDashboardVM,
  CalendarPageVM,
  CostSummaryVM,
  ConversationMessagePageVM,
  CreateWorkItemRequest,
  CreateProposalFromManifestRequest,
  CreateSessionRequest,
  // R20 wave4（R19-1 OKR 前端接线）：创建目标 + 挂链工作项的请求/响应契约。
  CreateObjectiveRequest,
  CreateObjectiveResponse,
  LinkObjectiveRequest,
  LinkObjectiveResponse,
  // R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板首屏真拉取 + 详情抽屉的响应契约。
  ListObjectivesResponse,
  ObjectiveDetailResponse,
  DrivePageVM,
  MeetingPageVM,
  ApplyMergeProposalCandidateRequest,
  ChooseMergeProposalCandidateRequest,
  EvidenceBubble,
  GoldPathSurfaceVM,
  Notification,
  NotificationPageVM,
  PilotDay1MetricsSnapshot,
  ProjectHealthPageVM,
  ProjectHomePageVM,
  ProjectListVM,
  ProjectTimelinePageVM,
  NotificationList,
  Proposal,
  ProposalConflictListResult,
  ProposalDetailVM,
  MergeProposalCandidateChoiceResult,
  ProposalMergeResult,
  RebaseProposalResult,
  ProposalReviewResult,
  ReplayTraceVM,
  ReviewProposalRequest,
  RespondApprovalRequest,
  DelegateApprovalRequest,
  ResolveEscalationRequest,
  DelegateEscalationRequest,
  AddApprovalCommentRequest,
  ApprovalCommentVM,
  MergeProposalRequest,
  NextQuestionRequest,
  SearchResultsVm,
  SearchScope,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  StartAgentRunRequest,
  UpdateUserPreferencesRequest,
  UseEvidenceForTaskRequest,
  UserPreferences,
  WorkbenchPageVM,
  WorkHubLocale,
  WorkItemDetailVM,
  // R14 批 MEM（记忆可见可治理）：用户记忆 + 团队技能两个治理管理面的 VM/请求契约。
  UserMemoryManagementPageVM,
  UserMemoryManagementItemVM,
  TeamSkillManagementPageVM,
  TeamSkillManagementItemVM,
  PatchUserMemoryRequest,
  PatchTeamSkillRequest,
  // R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」反馈的 PUT 请求体契约。
  PutAiFeedbackRequest,
  // R20 DSK-UX（R19-5 撤销学到的自动通过策略 / R19-3 撤销 AI 文件改动）：治理策略与快照回滚的写契约。
  PermissionPolicy,
  RevertAgentRunRequest,
  Snapshot
} from "@workhub/contracts";

// R20 DSK-UX（R19-3）：POST /api/agent-runs/:id/revert 的响应形状——把被还原的那次文件快照标记为
// reverted 并回吐它（供调用方确认/刷新）。服务端本地客户端门控，桌面天然满足。
export type RevertAgentRunResult = {
  status: "reverted";
  snapshot: Snapshot;
};

export type ApiOk<T> = {
  ok: true;
  data: T;
  meta?: {
    request_id?: string;
    version?: number;
    generated_at?: string;
  };
};

export type ApiErr = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    recoverable?: boolean;
  };
};

export type ApiEnvelope<T> = ApiOk<T> | ApiErr;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type WorkHubRequestCredentials = "omit" | "same-origin" | "include";

export type WorkHubApiClientOptions = {
  baseUrl?: string;
  fetchFn?: FetchLike;
  getClientToken?: () => string | undefined;
  credentials?: WorkHubRequestCredentials;
  /**
   * 每次请求的超时（毫秒）。设置后用 AbortController 在超时时中止请求，避免连接卡死时
   * UI 动作（合并/审批等）永远 pending。超时抛 WorkHubApiError(408, "request_timeout")。
   * 不设则无超时（保持原行为）。
   */
  requestTimeoutMs?: number;
};

export type MemoryConflictResolution = "keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both";

export type ResolveMemoryConflictRequest = {
  resolution: MemoryConflictResolution;
  expected_updated_at: string;
  value_md?: string;
};

export type MemoryConflictResolveResult = {
  conflict: unknown;
};

// B-R9.1-2：请求体不再携带 memories——记忆上下文由服务端读 user_memories/team_skills，
// 客户端注入面已删。
export type CreateTaskPlanRequest = Record<string, never>;

export type CreateTaskPlanResult = {
  plan_id: string;
  proposal_id: string;
  proposal_href: string;
  proposal: Proposal;
};

export type PageRequestOptions = {
  locale?: WorkHubLocale;
};

export type ApprovalPageRequestOptions = PageRequestOptions & {
  offset?: number;
  limit?: number;
};

export type DrivePageRequestOptions = PageRequestOptions & {
  projectId?: string;
  project_id?: string;
  // #5：项目主页「最近文件」深链 → 网盘高亮该文件。
  itemId?: string;
  item_id?: string;
  // R4：按名称搜索文件。
  q?: string;
};

export type MeetingPageRequestOptions = PageRequestOptions & {
  projectId?: string;
  project_id?: string;
  meetingId?: string;
  meeting_id?: string;
};

// R14 批 SEARCH（web-search-page）：GET /api/search 的请求参数——不挂 PageRequestOptions（服务端不认
// locale 参数，见 02-search-design.md §4 参数表：仅 q/scopes/limit）。scopes 缺省=服务端四 scope 全开。
export type SearchRequestParams = {
  q: string;
  scopes?: SearchScope[];
  limit?: number;
};

export type CalendarPageRequestOptions = PageRequestOptions & {
  date?: string;
  view?: "day" | "week";
};

export type PilotDay1MetricsRequestOptions = {
  from?: string;
  to?: string;
};

// R15 批 web-mirror（web 只读会话镜像）：会话消息读端点 GET /api/conversations/:id/messages 的
// 分页参数——契约层是 beforeSeq（反向：早于该 seq 的最新一页）与 afterSeq（正向：晚于该 seq）互斥
// 的联合（见 packages/contracts 的 conversationMessageListQuerySchema）。web 镜像只消费这个既有读
// 端点，不新增任何服务端能力。
export type ConversationMessageListRequestOptions = {
  beforeSeq?: number;
  afterSeq?: number;
  limit?: number;
};

// R14 批 MEM：用户记忆列表可选按 category 过滤（服务端 GET /api/me/memories?category=）。
export type UserMemoryListRequestOptions = {
  category?: "preference" | "correction" | "recurring_context";
};

export type DriveUploadFileRequest = {
  filename: string;
  mime?: string;
  size_bytes?: number;
  sha256?: string;
  parsed_text?: string;
  parent_id?: string | null;
} | {
  file: Blob;
  filename?: string;
  mime?: string;
  parsed_text?: string;
  parent_id?: string | null;
};

export type DriveDeleteItemRequest = {
  expected_current_version_id?: string | null;
};

export type HealthResponse = {
  ok: true;
  service: string;
  env?: string;
  runtime: string;
  port: number;
};

export type IdentifyRequest = {
  nickname: string;
  admin_secret?: string;
};

// R2 auth epic（密码登录）：桌面在密码/hybrid 模式先用凭据登录建会话，再走 bootstrapDesktop 换设备令牌。
// 明文密码只走请求体（POST /api/auth/login），绝不进 URL/query。
export type PasswordLoginRequest = {
  email: string;
  password: string;
};

export type IdentityResponse = {
  id: string;
  nickname: string;
  display_name: string;
  created: boolean;
  locale: WorkHubLocale;
  preferences: UserPreferences;
  is_admin: boolean;
  availability_status: string;
  availability_text?: string;
};

export type EscalationResolveResult = {
  escalation: {
    id: string;
    work_item_id: string;
    resolved_at?: string;
  };
  work_item_status: WorkItemDetailVM["workitem"]["status"];
  attention: {
    summary_text: string;
  };
};

export type EscalationDelegateResult = {
  escalation: {
    id: string;
    work_item_id: string;
    suggested_lead_user_id: string | null;
  };
  attention: {
    summary_text: string;
  };
};

export type PageClient = {
  attention: (options?: PageRequestOptions) => Promise<AttentionHomeVM>;
  approvals: (options?: ApprovalPageRequestOptions) => Promise<ApprovalCenterVM>;
  cost: (options?: PageRequestOptions) => Promise<CostDashboardVM>;
  agents: (options?: PageRequestOptions) => Promise<AgentArmyDashboardVM>;
  skills: (options?: PageRequestOptions) => Promise<TeamSkillsPageVM>;
  settings: (options?: PageRequestOptions) => Promise<SettingsPageVM>;
  goldPath: (options?: PageRequestOptions) => Promise<GoldPathSurfaceVM>;
  drive: (options?: DrivePageRequestOptions) => Promise<DrivePageVM>;
  meetings: (options?: MeetingPageRequestOptions) => Promise<MeetingPageVM>;
  notifications: (options?: PageRequestOptions) => Promise<NotificationPageVM>;
  calendar: (options?: CalendarPageRequestOptions) => Promise<CalendarPageVM>;
  projectHealth: (options?: PageRequestOptions) => Promise<ProjectHealthPageVM>;
  project: (id: string, options?: PageRequestOptions) => Promise<ProjectHomePageVM>;
  workItem: (id: string, options?: PageRequestOptions) => Promise<WorkItemDetailVM>;
  proposal: (id: string, options?: PageRequestOptions) => Promise<ProposalDetailVM>;
  // R12 批 1：桌面工作台 bootstrap VM（项目元信息 + 首屏会话 + 工作区成员切片 + 军团/最近文件摘要）。
  // 可选（而不是像其它 page 方法那样必填）：这个字段目前只有桌面工作台窗口消费；标成必填会强迫
  // apps/web 等其它 workspace 里已有的完整 PageClient 字面量 mock 也补一个用不到的桩——那些文件不在
  // 本批改动范围内（apps/desktop-webview/**、packages/api-client/**、报告文件），不能顺手改。
  workbench?: (projectId: string, options?: PageRequestOptions) => Promise<WorkbenchPageVM>;
  // R15 批 E2（项目时间线 / 甘特）：里程碑分组的排期条 + 关键路径 VM（GET /api/pages/project/:id/timeline）。
  // 桌面工作台「时间线」标签与 web /projects/:id/timeline 只读页共用这一个只读端点。可选（同 workbench）：
  // 只有这两处消费，标必填会强迫既有 PageClient 字面量 mock 补一个用不到的桩。
  projectTimeline?: (projectId: string, options?: PageRequestOptions) => Promise<ProjectTimelinePageVM>;
};

export type PushStreamClient = {
  all: () => string;
  me: () => string;
  workItem: (id: string) => string;
  run: (id: string) => string;
  session: (id: string) => string;
  proposal: (id: string) => string;
  conversation: (id: string) => string;
};

export type WorkHubApiClient = {
  health: () => Promise<HealthResponse>;
  openapi: () => Promise<unknown>;
  identify: (payload: IdentifyRequest) => Promise<IdentityResponse>;
  // 桌面凭据登录（密码/hybrid 模式）：POST /api/auth/login 建会话 cookie，随后 bootstrapDesktop 据会话换 client_token。
  login: (payload: PasswordLoginRequest) => Promise<IdentityResponse>;
  // 桌面首启引导：昵称模式=昵称 identify + 设备注册一步到位；密码/hybrid 模式=凭已登录会话换设备令牌。均返回 client_token。
  bootstrapDesktop: (payload: DesktopBootstrapRequest) => Promise<DesktopBootstrapResponse>;
  // 设备管理（需已鉴权）：注册 / 列表 / 当前 / 吊销。
  registerClientDevice: (payload: ClientDeviceRegisterRequest) => Promise<ClientDeviceRegisterResponse>;
  listClientDevices: () => Promise<ClientDeviceResponse[]>;
  currentClientDevice: () => Promise<ClientDeviceResponse>;
  revokeClientDevice: (deviceId: string) => Promise<ClientDeviceResponse>;
  revokeCurrentClientDevice: () => Promise<ClientDeviceResponse>;
  logout: () => Promise<{ ok: boolean }>;
  me: () => Promise<IdentityResponse | null>;
  updatePreferences: (payload: UpdateUserPreferencesRequest) => Promise<IdentityResponse>;
  notifications: () => Promise<NotificationList>;
  markNotificationRead: (id: string) => Promise<Notification>;
  markAllNotificationsRead: () => Promise<{ updated: number }>;
  dismissNotification: (id: string) => Promise<Notification>;
  completeNotification: (id: string) => Promise<Notification>;
  // R15 批 A（A2 提醒阶梯）：暂停一条通知的 24h 提醒（POST /snooze，服务端置 next_remind_at=null）。
  snoozeNotification: (id: string) => Promise<Notification>;
  // G4 #10（关怀 opt-out）：偏好里额外带 care_messages_enabled（Cuu 关怀私聊开关，默认 true）。
  getNotificationPreferences: () => Promise<{ muted_notification_types: string[]; care_messages_enabled: boolean }>;
  // options.careMessagesEnabled 缺省＝不动关怀开关（沿用当前存量，服务端同口径）。
  setNotificationPreferences: (
    mutedNotificationTypes: string[],
    options?: { careMessagesEnabled?: boolean }
  ) => Promise<{ muted_notification_types: string[]; care_messages_enabled: boolean }>;
  bootstrapProject: (payload?: BootstrapProjectRequest) => Promise<BootstrapProjectResult>;
  createSession: (payload?: CreateSessionRequest, options?: PageRequestOptions) => Promise<SessionVM>;
  getSession: (id: string, options?: PageRequestOptions) => Promise<SessionVM>;
  createWorkItem: (payload: CreateWorkItemRequest, options?: PageRequestOptions) => Promise<WorkItemDetailVM>;
  createTaskPlan: (workItemId: string, payload?: CreateTaskPlanRequest, options?: PageRequestOptions) => Promise<CreateTaskPlanResult>;
  // R20 wave4（R19-1 OKR 前端接线）：创建目标（可带关键结果）+ 把工作项挂到目标上——后端早已有
  // POST /api/objectives 与 POST /api/objectives/:id/link，此前没有任何类型化客户端方法能调用它们。
  createObjective: (payload: CreateObjectiveRequest) => Promise<CreateObjectiveResponse>;
  linkObjective: (objectiveId: string, payload: LinkObjectiveRequest) => Promise<LinkObjectiveResponse>;
  // R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板首屏真拉取（按 project id 挂 URL，实际列出该
  // 项目所在工作区的全部目标——目标是工作区级实体）+ 详情抽屉（含关键结果/挂链工作项/挂链执行计划）。
  // 服务端 GET /api/projects/:id/objectives 与 GET /api/objectives/:id 早已就位（routes/projects.ts、
  // routes/objectives.ts），此前没有任何类型化客户端方法能调用——与 createObjective/linkObjective 同批
  // 加入、同样标必填（本文件手写全量字面量 mock 的两处需跟着补桩，见 apps/web、apps/desktop-webview 的
  // main.test.ts）。
  listObjectives: (projectId: string) => Promise<ListObjectivesResponse>;
  getObjective: (objectiveId: string) => Promise<ObjectiveDetailResponse>;
  startAgentRun: (workItemId: string, payload?: StartAgentRunRequest, options?: PageRequestOptions) => Promise<AgentRunLiveVM>;
  getAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  getAgentRunTrace: (runId: string, after?: number) => Promise<AgentStep[]>;
  abortAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  // R20 DSK-UX（R19-3）：撤销这次 AI 执行对某个文件的改动（还原快照）。要求本地客户端——桌面壳层天然满足，
  // web 端到不了这个写动作（与 restore/权限撤销同一道本地客户端门）。可选（同 workbench?/putProposalFeedback? 的
  // 既有取舍）：标必填会强迫 apps/web 等其它 workspace 里已有的完整 WorkHubApiClient 字面量 mock 补一个用不到的
  // 桩，那些文件不在本批改动范围内；真实 createApiClient() 一定实现它，调用点用 `!` 断言（同 putProposalFeedback）。
  revertAgentRun?: (runId: string, payload: RevertAgentRunRequest) => Promise<RevertAgentRunResult>;
  // R20 R19-29：getAgentRunHandoff（GET /api/agent-runs/:id/handoff）已删——web/desktop 均无调用点，
  // 结构化 handoff 数据早已内嵌进 replayAgentRun 的回放页，核实零消费后随后端路由/openapi 一并删除。
  respondApproval: (id: string, payload: RespondApprovalRequest) => Promise<unknown>;
  // R12（批量效率）：多选批量放行（allow-only）。
  respondApprovalsBatch: (ids: string[]) => Promise<{ approved: number; skipped: number }>;
  delegateApproval: (id: string, payload: DelegateApprovalRequest) => Promise<unknown>;
  // B-R9.6 UX：plan_review 卡「先不拆，单个 AI 跑」。
  skipTaskPlanProposal: (proposalId: string, options?: PageRequestOptions) => Promise<{ run_id: string; work_item_id: string; attention: { summary_text: string } }>;
  // B-R9.6 §3.1：军团「暂停/恢复派发」。
  pauseTaskPlan: (planId: string) => Promise<{ plan_id: string; status: string }>;
  resumeTaskPlan: (planId: string) => Promise<{ plan_id: string; status: string }>;
  resolveEscalation: (id: string, payload: ResolveEscalationRequest, options?: PageRequestOptions) => Promise<EscalationResolveResult>;
  resolveBudgetDecision: (id: string, actionId: string, options?: PageRequestOptions) => Promise<EscalationResolveResult>;
  delegateEscalation: (id: string, payload: DelegateEscalationRequest, options?: PageRequestOptions) => Promise<EscalationDelegateResult>;
  resolveMemoryConflict: (id: string, payload: ResolveMemoryConflictRequest) => Promise<MemoryConflictResolveResult>;
  listApprovalComments: (id: string) => Promise<ApprovalCommentVM[]>;
  postApprovalComment: (id: string, payload: AddApprovalCommentRequest) => Promise<ApprovalCommentVM>;
  createProposalFromManifest: (workItemId: string, payload: CreateProposalFromManifestRequest) => Promise<Proposal>;
  // R20 R19-29：listWorkItemProposals（GET /api/workitems/:id/proposals）已删——web/desktop 均无调用点，
  // 同样的提议列表数据早已内嵌进工作项详情页 VM，核实零消费后随后端路由/openapi 一并删除。
  listWorkItemConflicts: (workItemId: string) => Promise<ProposalConflictListResult>;
  // R20 R19-27：跨 run 审计时间线（快照 + 审计日志事实 + manifest 校验），供工作项详情页渲染。
  // 服务端已有 GET /api/workitems/:id/audit（fail-closed 走 detailPage 同一套可见性），此前没有
  // 任何类型化客户端方法能调用它——前端因此从来没有拉过这份数据、更别提渲染。
  getWorkItemAuditTimeline: (workItemId: string) => Promise<AuditTimelineVM>;
  // R23 P4（R20 P2A 端点上界面）：工作项指派/认领与评论流四个端点此前零客户端方法、两端零界面。
  // assign 需要「管理员 / 提交人 / 现任 lead」资格，claim 只在事项还没人认领且处于可认领状态时成立——
  // 两个资格都由详情页 VM 的 can_assign / can_claim 下发，前端不自己判权限。
  assignWorkItem: (workItemId: string, payload: AssignWorkItemRequest) => Promise<AssignWorkItemResult>;
  claimWorkItem: (workItemId: string) => Promise<ClaimWorkItemResult>;
  listWorkItemComments: (workItemId: string) => Promise<WorkItemCommentsResult>;
  createWorkItemComment: (workItemId: string, payload: CreateWorkItemCommentRequest) => Promise<WorkItemComment>;
  getProposal: (id: string) => Promise<Proposal>;
  reviewProposal: (id: string, payload: ReviewProposalRequest, options?: PageRequestOptions) => Promise<ProposalReviewResult>;
  mergeProposal: (id: string, payload?: MergeProposalRequest, options?: PageRequestOptions) => Promise<ProposalMergeResult>;
  // R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」轻反馈——204 No Content，无回执体。
  // 必需字段（集成收口，与 search/治理面同口径）：两侧穷举 mock 的存根由集成者补齐。
  putProposalFeedback: (id: string, payload: PutAiFeedbackRequest) => Promise<void>;
  deleteProposalFeedback: (id: string) => Promise<void>;
  rebaseProposal: (id: string) => Promise<RebaseProposalResult>;
  chooseMergeProposalCandidate: (
    id: string,
    payload: ChooseMergeProposalCandidateRequest
  ) => Promise<MergeProposalCandidateChoiceResult>;
  applyMergeProposalCandidate: (
    id: string,
    payload?: ApplyMergeProposalCandidateRequest,
    options?: PageRequestOptions
  ) => Promise<ProposalMergeResult>;
  nextQuestion: (sessionId: string, payload?: NextQuestionRequest, options?: PageRequestOptions) => Promise<SessionVM>;
  searchKnowledge: (payload?: unknown, options?: PageRequestOptions) => Promise<EvidenceBubble>;
  // R14 批 SEARCH（web-search-page）：全局搜索统一读端点 GET /api/search（跨会话/网盘/工单/会议）。
  // 必需字段（集成收口改定）：可选方法会诱导 client.search?.() 静默吞调用；
  // desktop main.test.ts 的穷举 mock 已由集成者补对应存根。
  search: (params: SearchRequestParams) => Promise<SearchResultsVm>;
  useEvidenceForWorkItem: (workItemId: string, payload: UseEvidenceForTaskRequest) => Promise<WorkItemDetailVM>;
  restoreAcceptedDeliverable: (
    workItemId: string,
    acceptedChangeId: string
  ) => Promise<AcceptedDeliverableRestoreResult>;
  uploadDriveFile: (projectId: string, payload: DriveUploadFileRequest, options?: PageRequestOptions) => Promise<DrivePageVM>;
  deleteDriveItem: (projectId: string, itemId: string, payload?: DriveDeleteItemRequest, options?: PageRequestOptions) => Promise<DrivePageVM>;
  restoreDriveItem: (projectId: string, itemId: string, options?: PageRequestOptions) => Promise<DrivePageVM>;
  // UX-U3：网盘评论 composer。
  createDriveComment: (projectId: string, payload: { body: string; folder_id?: string }, options?: PageRequestOptions) => Promise<DrivePageVM>;
  createDriveCommentDraft: (projectId: string, commentId: string, options?: PageRequestOptions) => Promise<DrivePageVM>;
  createDriveDraftProposal: (workItemId: string, options?: PageRequestOptions) => Promise<WorkItemDetailVM>;
  createMeetingInsightDraft: (projectId: string, insightId: string, options?: PageRequestOptions) => Promise<MeetingPageVM>;
  // R10-P2-2：导入会议转写。
  importMeetingTranscript: (projectId: string, payload: { title: string; transcript_text: string }, options?: PageRequestOptions) => Promise<MeetingPageVM>;
  // R10-P2-5：委派选人器的数据源——活跃成员简表。web 会话镜像也复用它做发送者昵称解析。
  listUsers: () => Promise<{ users: Array<{ id: string; nickname: string; is_admin: boolean }> }>;
  // R15 批 web-mirror：只读会话镜像消费的既有会话消息读端点（参与者门控在服务端）。
  listConversationMessages: (
    conversationId: string,
    options?: ConversationMessageListRequestOptions
  ) => Promise<ConversationMessagePageVM>;
  dismissMeetingInsight: (projectId: string, insightId: string, options?: PageRequestOptions) => Promise<MeetingPageVM>;
  createMeetingDraftProposal: (workItemId: string, options?: PageRequestOptions) => Promise<WorkItemDetailVM>;
  /** SA-02：重新生成这场会议的纪要与洞察（AI 未配置 / 分析失败后的人工补跑入口）。 */
  reanalyzeMeeting: (meetingId: string, options?: PageRequestOptions) => Promise<MeetingPageVM>;
  costUsage: () => Promise<CostSummaryVM>;
  costPolicies: () => Promise<BudgetPolicy[]>;
  updateCostPolicy: (scope: BudgetPolicy["scope_kind"], id: string, payload: BudgetPolicyUpdate) => Promise<BudgetPolicy>;
  // R20 DSK-UX（R19-5）：撤销一条学到的自动通过/权限策略（DELETE /api/permissions/:id）。要求本地客户端 + 管理员
  // ——桌面壳层天然满足本地客户端门；策略列表本身也只有管理员能读到（见 settings VM 的 permission_policies）。
  // 可选：同 revertAgentRun 的取舍（避免强迫 apps/web 完整 client 字面量 mock 补桩），调用点用 `!` 断言。
  revokePermissionPolicy?: (id: string) => Promise<PermissionPolicy>;
  pilotDay1Metrics: (options?: PilotDay1MetricsRequestOptions) => Promise<PilotDay1MetricsSnapshot>;
  listProjects: () => Promise<ProjectListVM>;
  // R23 P4（R20 P2A 端点上界面）：项目生命周期两个破坏性动作。归档＝从团队项目列表隐去（可恢复语义由
  // 服务端定义），删除＝落墓碑。两者都只有管理员/项目所有者能做，项目主页据 can_manage_lifecycle 渲入口。
  archiveProject: (projectId: string) => Promise<ArchiveProjectResult>;
  deleteProject: (projectId: string) => Promise<DeleteProjectResult>;
  // R23 P4（R20 P2A 端点上界面）：工作区级审计流（仅管理员）。工作区不由客户端指定——服务端恒取自
  // 认证身份，这里只能传过滤与分页参数。
  listWorkspaceAudit: (query?: WorkspaceAuditQuery) => Promise<WorkspaceAuditListVM>;
  replayAgentRun: (runId: string, options?: PageRequestOptions) => Promise<ReplayTraceVM>;
  // R14 批 MEM（记忆可见可治理）：用户记忆治理面——本人可读写，管理员也不能代读/代改他人记忆。
  // 必需字段（集成收口改定，与 search 同口径）：可选方法会诱导 ?. 调用静默吞；两个穷举 mock 的存根
  // 由集成者补齐。
  listUserMemories: (options?: UserMemoryListRequestOptions) => Promise<UserMemoryManagementPageVM>;
  patchUserMemory: (id: string, payload: PatchUserMemoryRequest) => Promise<UserMemoryManagementItemVM>;
  deleteUserMemory: (id: string) => Promise<{ deleted: true }>;
  // 团队技能治理面——列表/详情全员可读，编辑/停用仅管理员（服务端 actor.isAdmin 门，403 兜底）。
  listTeamSkillsManage: () => Promise<TeamSkillManagementPageVM>;
  patchTeamSkillManage: (id: string, payload: PatchTeamSkillRequest) => Promise<TeamSkillManagementItemVM>;
  deactivateTeamSkillManage: (id: string, payload?: { reason?: string }) => Promise<{ deprecated: true }>;
  pages: PageClient;
  streams: PushStreamClient;
  streamUrl: (path: string) => string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};
