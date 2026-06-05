import type { UserAccessRecord, WorkItemAccessRecord, WorkItemAssignmentRecord } from "./types.js";

export const ASSIGNMENT_ROLES = ["lead", "collaborator"] as const;
export const ACTIVE_ASSIGNMENT_STATUSES = ["claimed", "doing", "revision_requested"] as const;

export function assignmentUserIds(workItem: WorkItemAccessRecord): Set<string> {
  return new Set((workItem.assignments ?? []).map((assignment) => assignment.userId));
}

export function hasExplicitAssignees(workItem: WorkItemAccessRecord): boolean {
  return Boolean(workItem.assignments?.length);
}

export function isAssignedUser(workItem: WorkItemAccessRecord, user: UserAccessRecord): boolean {
  if ((workItem.assignments ?? []).some((assignment) => assignment.userId === user.id)) {
    return true;
  }
  return Boolean(workItem.claimedByUserId && workItem.claimedByUserId === user.id);
}

export function leadAssignment(workItem: WorkItemAccessRecord): WorkItemAssignmentRecord | undefined {
  return (workItem.assignments ?? []).find((assignment) => assignment.role === "lead");
}
