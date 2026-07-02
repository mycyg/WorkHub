import type {
  ApprovalCenterVM,
  AgentRunLiveVM,
  AgentStep,
  AcceptedDeliverableRestoreResult,
  AttentionHomeVM,
  BudgetPolicy,
  BudgetPolicyUpdate,
  BootstrapProjectRequest,
  BootstrapProjectResult,
  ClientDeviceRegisterRequest,
  ClientDeviceRegisterResponse,
  ClientDeviceResponse,
  DesktopBootstrapRequest,
  DesktopBootstrapResponse,
  CostDashboardVM,
  CalendarPageVM,
  CostSummaryVM,
  CreateWorkItemRequest,
  CreateProposalFromManifestRequest,
  CreateSessionRequest,
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
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  StartAgentRunRequest,
  StructuredHandoff,
  UpdateUserPreferencesRequest,
  UseEvidenceForTaskRequest,
  UserPreferences,
  WorkHubLocale,
  WorkItemDetailVM
} from "@workhub/contracts";

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

export type PageRequestOptions = {
  locale?: WorkHubLocale;
};

export type DrivePageRequestOptions = PageRequestOptions & {
  projectId?: string;
  project_id?: string;
  // #5：项目主页「最近文件」深链 → 网盘高亮该文件。
  itemId?: string;
  item_id?: string;
};

export type MeetingPageRequestOptions = PageRequestOptions & {
  projectId?: string;
  project_id?: string;
  meetingId?: string;
  meeting_id?: string;
};

export type CalendarPageRequestOptions = PageRequestOptions & {
  date?: string;
  view?: "day" | "week";
};

export type PilotDay1MetricsRequestOptions = {
  from?: string;
  to?: string;
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
  approvals: (options?: PageRequestOptions) => Promise<ApprovalCenterVM>;
  cost: (options?: PageRequestOptions) => Promise<CostDashboardVM>;
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
};

export type PushStreamClient = {
  all: () => string;
  me: () => string;
  workItem: (id: string) => string;
  run: (id: string) => string;
  session: (id: string) => string;
  proposal: (id: string) => string;
};

export type WorkHubApiClient = {
  health: () => Promise<HealthResponse>;
  openapi: () => Promise<unknown>;
  identify: (payload: IdentifyRequest) => Promise<IdentityResponse>;
  // 桌面首启引导：昵称 identify + 设备注册一步到位，返回 client_token（仅昵称模式）。
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
  getNotificationPreferences: () => Promise<{ muted_notification_types: string[] }>;
  setNotificationPreferences: (
    mutedNotificationTypes: string[]
  ) => Promise<{ muted_notification_types: string[] }>;
  bootstrapProject: (payload?: BootstrapProjectRequest) => Promise<BootstrapProjectResult>;
  createSession: (payload?: CreateSessionRequest) => Promise<SessionVM>;
  getSession: (id: string, options?: PageRequestOptions) => Promise<SessionVM>;
  createWorkItem: (payload: CreateWorkItemRequest) => Promise<WorkItemDetailVM>;
  startAgentRun: (workItemId: string, payload?: StartAgentRunRequest) => Promise<AgentRunLiveVM>;
  getAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  getAgentRunTrace: (runId: string, after?: number) => Promise<AgentStep[]>;
  abortAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  getAgentRunHandoff: (runId: string) => Promise<StructuredHandoff | null>;
  respondApproval: (id: string, payload: RespondApprovalRequest) => Promise<unknown>;
  delegateApproval: (id: string, payload: DelegateApprovalRequest) => Promise<unknown>;
  resolveEscalation: (id: string, payload: ResolveEscalationRequest) => Promise<EscalationResolveResult>;
  delegateEscalation: (id: string, payload: DelegateEscalationRequest) => Promise<EscalationDelegateResult>;
  listApprovalComments: (id: string) => Promise<ApprovalCommentVM[]>;
  postApprovalComment: (id: string, payload: AddApprovalCommentRequest) => Promise<ApprovalCommentVM>;
  createProposalFromManifest: (workItemId: string, payload: CreateProposalFromManifestRequest) => Promise<Proposal>;
  listWorkItemProposals: (workItemId: string) => Promise<Proposal[]>;
  listWorkItemConflicts: (workItemId: string) => Promise<ProposalConflictListResult>;
  getProposal: (id: string) => Promise<Proposal>;
  reviewProposal: (id: string, payload: ReviewProposalRequest) => Promise<ProposalReviewResult>;
  mergeProposal: (id: string, payload?: MergeProposalRequest) => Promise<ProposalMergeResult>;
  rebaseProposal: (id: string) => Promise<RebaseProposalResult>;
  chooseMergeProposalCandidate: (
    id: string,
    payload: ChooseMergeProposalCandidateRequest
  ) => Promise<MergeProposalCandidateChoiceResult>;
  applyMergeProposalCandidate: (
    id: string,
    payload?: ApplyMergeProposalCandidateRequest
  ) => Promise<ProposalMergeResult>;
  nextQuestion: (sessionId: string, payload?: NextQuestionRequest) => Promise<SessionVM>;
  searchKnowledge: (payload?: unknown, options?: PageRequestOptions) => Promise<EvidenceBubble>;
  useEvidenceForWorkItem: (workItemId: string, payload: UseEvidenceForTaskRequest) => Promise<WorkItemDetailVM>;
  restoreAcceptedDeliverable: (
    workItemId: string,
    acceptedChangeId: string
  ) => Promise<AcceptedDeliverableRestoreResult>;
  uploadDriveFile: (projectId: string, payload: DriveUploadFileRequest, options?: PageRequestOptions) => Promise<DrivePageVM>;
  deleteDriveItem: (projectId: string, itemId: string, payload?: DriveDeleteItemRequest, options?: PageRequestOptions) => Promise<DrivePageVM>;
  restoreDriveItem: (projectId: string, itemId: string, options?: PageRequestOptions) => Promise<DrivePageVM>;
  createDriveCommentDraft: (projectId: string, commentId: string, options?: PageRequestOptions) => Promise<DrivePageVM>;
  createDriveDraftProposal: (workItemId: string, options?: PageRequestOptions) => Promise<WorkItemDetailVM>;
  createMeetingInsightDraft: (projectId: string, insightId: string, options?: PageRequestOptions) => Promise<MeetingPageVM>;
  dismissMeetingInsight: (projectId: string, insightId: string, options?: PageRequestOptions) => Promise<MeetingPageVM>;
  createMeetingDraftProposal: (workItemId: string, options?: PageRequestOptions) => Promise<WorkItemDetailVM>;
  costUsage: () => Promise<CostSummaryVM>;
  costPolicies: () => Promise<BudgetPolicy[]>;
  updateCostPolicy: (scope: BudgetPolicy["scope_kind"], id: string, payload: BudgetPolicyUpdate) => Promise<BudgetPolicy>;
  pilotDay1Metrics: (options?: PilotDay1MetricsRequestOptions) => Promise<PilotDay1MetricsSnapshot>;
  listProjects: () => Promise<ProjectListVM>;
  replayAgentRun: (runId: string, options?: PageRequestOptions) => Promise<ReplayTraceVM>;
  pages: PageClient;
  streams: PushStreamClient;
  streamUrl: (path: string) => string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};
