import type {
  ApprovalCenterVM,
  AgentRunLiveVM,
  AgentStep,
  AttentionHomeVM,
  BudgetPolicy,
  BudgetPolicyUpdate,
  CostDashboardVM,
  CostSummaryVM,
  CreateWorkItemRequest,
  CreateProposalFromManifestRequest,
  CreateSessionRequest,
  EvidenceBubble,
  GoldPathSurfaceVM,
  NotificationList,
  Proposal,
  ProposalDetailVM,
  ProposalMergeResult,
  ProposalReviewResult,
  QuestionCard,
  ReplayTraceVM,
  ReviewProposalRequest,
  RespondApprovalRequest,
  MergeProposalRequest,
  SessionVM,
  StartAgentRunRequest,
  StructuredHandoff,
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
  is_admin: boolean;
  availability_status: string;
  availability_text?: string;
};

export type PageClient = {
  attention: () => Promise<AttentionHomeVM>;
  approvals: () => Promise<ApprovalCenterVM>;
  cost: () => Promise<CostDashboardVM>;
  goldPath: () => Promise<GoldPathSurfaceVM>;
  workItem: (id: string) => Promise<WorkItemDetailVM>;
  proposal: (id: string) => Promise<ProposalDetailVM>;
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
  getProposal: (id: string) => Promise<Proposal>;
  reviewProposal: (id: string, payload: ReviewProposalRequest) => Promise<ProposalReviewResult>;
  mergeProposal: (id: string, payload?: MergeProposalRequest) => Promise<ProposalMergeResult>;
  nextQuestion: (sessionId: string) => Promise<QuestionCard>;
  searchKnowledge: (payload?: unknown) => Promise<EvidenceBubble>;
  costUsage: () => Promise<CostSummaryVM>;
  costPolicies: () => Promise<BudgetPolicy[]>;
  updateCostPolicy: (scope: BudgetPolicy["scope_kind"], id: string, payload: BudgetPolicyUpdate) => Promise<BudgetPolicy>;
  replayAgentRun: (runId: string) => Promise<ReplayTraceVM>;
  pages: PageClient;
  streams: PushStreamClient;
  streamUrl: (path: string) => string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};
