import type {
  ApprovalCenterVM,
  AgentRunLiveVM,
  AgentStep,
  AcceptedDeliverableRestoreResult,
  AttentionHomeVM,
  BudgetPolicy,
  BudgetPolicyUpdate,
  CostDashboardVM,
  CostSummaryVM,
  CreateWorkItemRequest,
  CreateProposalFromManifestRequest,
  CreateSessionRequest,
  ApplyMergeProposalCandidateRequest,
  ChooseMergeProposalCandidateRequest,
  EvidenceBubble,
  GoldPathSurfaceVM,
  NotificationList,
  Proposal,
  ProposalConflictListResult,
  ProposalDetailVM,
  MergeProposalCandidateChoiceResult,
  ProposalMergeResult,
  ProposalReviewResult,
  ReplayTraceVM,
  ReviewProposalRequest,
  RespondApprovalRequest,
  MergeProposalRequest,
  NextQuestionRequest,
  SessionVM,
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
};

export type PageRequestOptions = {
  locale?: WorkHubLocale;
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

export type PageClient = {
  attention: (options?: PageRequestOptions) => Promise<AttentionHomeVM>;
  approvals: (options?: PageRequestOptions) => Promise<ApprovalCenterVM>;
  cost: (options?: PageRequestOptions) => Promise<CostDashboardVM>;
  goldPath: (options?: PageRequestOptions) => Promise<GoldPathSurfaceVM>;
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
  me: () => Promise<IdentityResponse | null>;
  updatePreferences: (payload: UpdateUserPreferencesRequest) => Promise<IdentityResponse>;
  notifications: () => Promise<NotificationList>;
  createSession: (payload?: CreateSessionRequest) => Promise<SessionVM>;
  createWorkItem: (payload: CreateWorkItemRequest) => Promise<WorkItemDetailVM>;
  startAgentRun: (workItemId: string, payload?: StartAgentRunRequest) => Promise<AgentRunLiveVM>;
  getAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  getAgentRunTrace: (runId: string, after?: number) => Promise<AgentStep[]>;
  abortAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  getAgentRunHandoff: (runId: string) => Promise<StructuredHandoff | null>;
  respondApproval: (id: string, payload: RespondApprovalRequest) => Promise<unknown>;
  createProposalFromManifest: (workItemId: string, payload: CreateProposalFromManifestRequest) => Promise<Proposal>;
  listWorkItemProposals: (workItemId: string) => Promise<Proposal[]>;
  listWorkItemConflicts: (workItemId: string) => Promise<ProposalConflictListResult>;
  getProposal: (id: string) => Promise<Proposal>;
  reviewProposal: (id: string, payload: ReviewProposalRequest) => Promise<ProposalReviewResult>;
  mergeProposal: (id: string, payload?: MergeProposalRequest) => Promise<ProposalMergeResult>;
  chooseMergeProposalCandidate: (
    id: string,
    payload: ChooseMergeProposalCandidateRequest
  ) => Promise<MergeProposalCandidateChoiceResult>;
  applyMergeProposalCandidate: (
    id: string,
    payload?: ApplyMergeProposalCandidateRequest
  ) => Promise<ProposalMergeResult>;
  nextQuestion: (sessionId: string, payload?: NextQuestionRequest) => Promise<SessionVM>;
  searchKnowledge: (payload?: unknown) => Promise<EvidenceBubble>;
  useEvidenceForWorkItem: (workItemId: string, payload: UseEvidenceForTaskRequest) => Promise<WorkItemDetailVM>;
  restoreAcceptedDeliverable: (
    workItemId: string,
    acceptedChangeId: string
  ) => Promise<AcceptedDeliverableRestoreResult>;
  costUsage: () => Promise<CostSummaryVM>;
  costPolicies: () => Promise<BudgetPolicy[]>;
  updateCostPolicy: (scope: BudgetPolicy["scope_kind"], id: string, payload: BudgetPolicyUpdate) => Promise<BudgetPolicy>;
  replayAgentRun: (runId: string, options?: PageRequestOptions) => Promise<ReplayTraceVM>;
  pages: PageClient;
  streams: PushStreamClient;
  streamUrl: (path: string) => string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};
