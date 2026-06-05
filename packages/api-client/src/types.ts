import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  EvidenceBubble,
  GoldPathSurfaceVM,
  NotificationList,
  ProposalDetailVM,
  QuestionCard,
  ReplayTraceVM,
  RespondApprovalRequest,
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

export type WorkHubApiClient = {
  health: () => Promise<HealthResponse>;
  openapi: () => Promise<unknown>;
  identify: (payload: IdentifyRequest) => Promise<IdentityResponse>;
  me: () => Promise<IdentityResponse | null>;
  notifications: () => Promise<NotificationList>;
  respondApproval: (id: string, payload: RespondApprovalRequest) => Promise<unknown>;
  nextQuestion: (sessionId: string) => Promise<QuestionCard>;
  searchKnowledge: (payload?: unknown) => Promise<EvidenceBubble>;
  replayAgentRun: (runId: string) => Promise<ReplayTraceVM>;
  pages: PageClient;
  streamUrl: (path: string) => string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};
