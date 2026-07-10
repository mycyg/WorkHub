import type {
  ApprovalKind,
  AttentionItem,
  PermissionEffect,
  PermissionScopeKind,
  RiskLevel,
  WorkHubLocale
} from "@workhub/contracts";

export type PermissionActor = {
  id: string;
  kind?: "human" | "ai" | "system" | string;
  label?: string;
  userId?: string;
  isAdmin?: boolean;
  orgId?: string;
  workspaceId?: string;
  sessionId?: string;
  roleIds?: readonly string[];
};

export type PermissionPolicyRecord = {
  id?: string;
  scopeKind: PermissionScopeKind;
  scopeId: string;
  actionPattern: string;
  effect: PermissionEffect;
  priority?: number;
  learnedFromSession?: boolean;
  reason?: string | null;
  orgId?: string | null;
  workspaceId?: string | null;
  deletedAt?: Date | string | null;
};

export type PermissionDecision = {
  effect: PermissionEffect;
  actionPattern: string;
  reason?: string;
  matchedPolicy?: PermissionPolicyRecord;
  consideredPolicies: PermissionPolicyRecord[];
};

export type ToolLike = {
  id: string;
};

export type ProjectAccessRecord = {
  archived?: boolean | null;
  deletedAt?: Date | string | null;
  ownerUserId?: string | null;
  workspaceId?: string | null;
  orgId?: string | null;
};

export type WorkItemAssignmentRecord = {
  userId: string;
  role: string;
};

export type WorkItemAccessRecord = {
  id?: string;
  status: string;
  submitterUserId: string;
  claimedByUserId?: string | null;
  workspaceId?: string | null;
  orgId?: string | null;
  assignments?: readonly WorkItemAssignmentRecord[];
  project?: ProjectAccessRecord | null;
};

export type UserAccessRecord = {
  id: string;
  isAdmin?: boolean | null;
  deletedAt?: Date | string | null;
};

export type ResourceScope = {
  orgId?: string;
  workspaceId?: string;
};

export type ApprovalRequestRecord = {
  id: string;
  workItemId?: string | null;
  agentRunId?: string | null;
  actionPattern: string;
  payloadJson?: Record<string, unknown> | null;
  status: string;
  routedToUserId?: string | null;
  decidedByUserId?: string | null;
  decisionReasonMd?: string | null;
  delegatedToUserId?: string | null;
  slaDueAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
};

export type ApprovalAttentionOptions = {
  // R12（多项目）：多项目并行时卡片点名所属项目。
  projectName?: string;
  kind?: ApprovalKind;
  priority?: AttentionItem["priority"];
  riskLevel?: RiskLevel;
  locale?: WorkHubLocale;
};
