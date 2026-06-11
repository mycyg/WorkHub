import {
  approvalPayloadSchema,
  type ApprovalKind,
  type AttentionItem,
  type EvidenceRef,
  type RiskLevel
} from "@workhub/contracts";

import { canViewWorkItemRecord } from "./resource-permissions.js";
import { leadAssignment } from "./assignments.js";
import type {
  ApprovalAttentionOptions,
  ApprovalRequestRecord,
  UserAccessRecord,
  WorkItemAccessRecord
} from "./types.js";

type ApprovalActionCopyKey = "approve" | "deny" | "delegate";

const approvalActionCopy: Record<NonNullable<ApprovalAttentionOptions["locale"]>, Record<ApprovalActionCopyKey, string>> = {
  "zh-CN": {
    approve: "同意",
    deny: "打回",
    delegate: "转交"
  },
  "en-US": {
    approve: "Approve",
    deny: "Request changes",
    delegate: "Delegate"
  }
};

function approvalActionLabel(locale: ApprovalAttentionOptions["locale"] | undefined, key: ApprovalActionCopyKey) {
  return approvalActionCopy[locale ?? "zh-CN"][key];
}

function toIsoDate(input: Date | string | null | undefined) {
  if (!input) {
    return undefined;
  }
  return input instanceof Date ? input.toISOString() : input;
}

export function approvalRiskLevel(approval: Pick<ApprovalRequestRecord, "payloadJson">): RiskLevel | undefined {
  const parsed = approvalPayloadSchema.safeParse(approval.payloadJson ?? {});
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data.ui?.risk?.level;
}

export function toApprovalAttentionItem(
  approval: ApprovalRequestRecord,
  options: ApprovalAttentionOptions = {}
): AttentionItem {
  const payload = approvalPayloadSchema.safeParse(approval.payloadJson ?? {});
  const ui = payload.success ? payload.data.ui : undefined;
  const summaryText = ui?.summary_text ?? "AI 想继续执行一个需要你确认的操作。";
  const reasonText = ui?.reason_text;
  const evidenceRefs = ui?.evidence_refs as EvidenceRef[] | undefined;
  const requiresDesktop = ui?.requires_desktop ?? false;
  const locale = options.locale ?? "zh-CN";

  return {
    id: approval.id,
    kind: options.kind === "proposal" || options.kind === "revision" ? "proposal_review" : "approval",
    priority: options.priority ?? (ui?.risk?.level === "high" ? "urgent" : "normal"),
    ...(approval.workItemId ? { work_item_id: approval.workItemId } : {}),
    source_ref: {
      entity_type: "approval_request",
      entity_id: approval.id
    },
    title: summaryText,
    summary_text: summaryText,
    ...(reasonText ? { reason_text: reasonText } : {}),
    ...(evidenceRefs ? { evidence_refs: evidenceRefs } : {}),
    actions: [
      {
        id: "approve",
        label: approvalActionLabel(locale, "approve"),
        style: "primary",
        method: "POST",
        href: `/api/approvals/${approval.id}/respond`,
        requires_desktop: requiresDesktop
      },
      {
        id: "deny",
        label: approvalActionLabel(locale, "deny"),
        style: "danger",
        method: "POST",
        href: `/api/approvals/${approval.id}/respond`,
        requires_desktop: requiresDesktop,
        requires_reason: true
      },
      {
        id: "delegate",
        label: approvalActionLabel(locale, "delegate"),
        style: "secondary",
        method: "POST",
        href: `/api/approvals/${approval.id}/delegate`,
        requires_desktop: requiresDesktop
      }
    ],
    cuu_state: "asking_approval",
    created_at: toIsoDate(approval.createdAt) ?? new Date(0).toISOString(),
    ...(toIsoDate(approval.slaDueAt) ? { expires_at: toIsoDate(approval.slaDueAt) } : {})
  };
}

export type RouteApproverInput = {
  kind: ApprovalKind;
  workItem: WorkItemAccessRecord;
  requesterUserId?: string;
  users: readonly UserAccessRecord[];
};

function usableCandidate(
  workItem: WorkItemAccessRecord,
  requesterUserId: string | undefined,
  users: readonly UserAccessRecord[],
  candidateId: string | null | undefined
) {
  if (!candidateId || candidateId === requesterUserId) {
    return undefined;
  }
  const user = users.find((candidate) => candidate.id === candidateId && candidate.deletedAt == null);
  if (!user || !canViewWorkItemRecord(workItem, user)) {
    return undefined;
  }
  return user.id;
}

export function routeApprover(input: RouteApproverInput): string | undefined {
  if (input.kind === "proposal" || input.kind === "revision") {
    return usableCandidate(input.workItem, input.requesterUserId, input.users, input.workItem.submitterUserId);
  }

  const lead = leadAssignment(input.workItem);
  const routedLead = usableCandidate(input.workItem, input.requesterUserId, input.users, lead?.userId);
  if (routedLead) {
    return routedLead;
  }

  const owner = usableCandidate(input.workItem, input.requesterUserId, input.users, input.workItem.project?.ownerUserId);
  if (owner) {
    return owner;
  }

  return input.users.find(
    (user) => user.isAdmin && user.deletedAt == null && user.id !== input.requesterUserId
  )?.id;
}
