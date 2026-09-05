import { hasExplicitAssignees, isAssignedUser, leadAssignment } from "./assignments.js";
import type { PermissionActor, ProjectAccessRecord, ResourceScope, UserAccessRecord, WorkItemAccessRecord } from "./types.js";

export const PRIVATE_WORK_ITEM_STATUSES = ["intake", "ai_clarifying", "spec_ready"] as const;
export const ASSIGNMENT_EDITABLE_STATUSES = new Set([
  "intake",
  "ai_clarifying",
  "spec_ready",
  "ai_working",
  "escalated",
  "pm_mode",
  "in_review"
]);

export function isAdmin(user: UserAccessRecord): boolean {
  return Boolean(user.isAdmin);
}

export function isSubmitter(workItem: WorkItemAccessRecord, user: UserAccessRecord): boolean {
  return workItem.submitterUserId === user.id;
}

export function isAssignee(workItem: WorkItemAccessRecord, user: UserAccessRecord): boolean {
  return isAssignedUser(workItem, user);
}

export function workItemProjectIsActive(workItem: WorkItemAccessRecord): boolean {
  const project = workItem.project;
  return Boolean(project && !project.archived && project.deletedAt == null);
}

function scopeMatches(workItem: WorkItemAccessRecord, scope?: ResourceScope): boolean {
  if (!scope) {
    return true;
  }
  if (scope.workspaceId && scope.workspaceId !== workItem.workspaceId && scope.workspaceId !== workItem.project?.workspaceId) {
    return false;
  }
  if (scope.orgId && scope.orgId !== workItem.orgId && scope.orgId !== workItem.project?.orgId) {
    return false;
  }
  return true;
}

function projectIsActive(project: ProjectAccessRecord): boolean {
  return Boolean(!project.archived && project.deletedAt == null);
}

function projectScopeMatches(project: ProjectAccessRecord, actor: Pick<PermissionActor, "orgId" | "workspaceId">): boolean {
  // CORE-07：工作区栅栏 fail-closed——此前 `project.workspaceId && actor.workspaceId && …` 的写法
  // 在任一侧为 null 时直接放行（双 null 存量行 → 跨工作区可见/可管）。现在 null 一律视为不匹配；
  // admin 的跨工作区只读不走这里（canViewProjectDrive 用 org 级 projectOrgMatches），不受影响。
  if (!project.workspaceId || !actor.workspaceId || project.workspaceId !== actor.workspaceId) {
    return false;
  }
  if (project.orgId && actor.orgId && project.orgId !== actor.orgId) {
    return false;
  }
  return true;
}

function projectActorUserId(actor: Pick<PermissionActor, "id" | "userId">): string | undefined {
  return actor.userId ?? actor.id;
}

function projectOrgMatches(project: ProjectAccessRecord, actor: Pick<PermissionActor, "orgId">): boolean {
  return !(project.orgId && actor.orgId && project.orgId !== actor.orgId);
}

export function canViewProjectDrive(
  project: ProjectAccessRecord,
  actor: Pick<PermissionActor, "id" | "userId" | "isAdmin" | "orgId" | "workspaceId">
): boolean {
  if (!projectIsActive(project)) {
    return false;
  }
  // Admin read is an org-level overview: it can cross workspaces inside the same org,
  // but it must not cross org boundaries or revive archived/deleted projects.
  if (actor.isAdmin === true) {
    return projectOrgMatches(project, actor);
  }
  if (!projectScopeMatches(project, actor)) {
    return false;
  }
  if (project.ownerUserId && project.ownerUserId === projectActorUserId(actor)) {
    return true;
  }
  return Boolean(project.workspaceId && actor.workspaceId && project.workspaceId === actor.workspaceId);
}

export function canManageProjectDrive(
  project: ProjectAccessRecord,
  actor: Pick<PermissionActor, "id" | "userId" | "isAdmin" | "orgId" | "workspaceId">
): boolean {
  if (!projectIsActive(project)) {
    return false;
  }
  if (actor.isAdmin === true) {
    return projectScopeMatches(project, actor);
  }
  return canViewProjectDrive(project, actor);
}

export function canViewProjectMeetings(
  project: ProjectAccessRecord,
  actor: Pick<PermissionActor, "id" | "userId" | "isAdmin" | "orgId" | "workspaceId">
): boolean {
  return canViewProjectDrive(project, actor);
}

export function canManageProjectMeeting(
  project: ProjectAccessRecord,
  meeting: { uploadedByUserId: string },
  actor: Pick<PermissionActor, "id" | "userId" | "isAdmin" | "orgId" | "workspaceId">
): boolean {
  if (actor.isAdmin === true) {
    return projectIsActive(project) && projectScopeMatches(project, actor);
  }
  if (!projectIsActive(project)) {
    return false;
  }
  const actorUserId = projectActorUserId(actor);
  if (!actorUserId) {
    return false;
  }
  return project.ownerUserId === actorUserId || meeting.uploadedByUserId === actorUserId;
}

export function canViewWorkItemRecord(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  if (isSubmitter(workItem, user) || isAssignee(workItem, user)) {
    return true;
  }
  return !PRIVATE_WORK_ITEM_STATUSES.includes(workItem.status as (typeof PRIVATE_WORK_ITEM_STATUSES)[number]);
}

export function canViewWorkItemAssets(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  if (isSubmitter(workItem, user) || isAssignee(workItem, user)) {
    return true;
  }
  return !PRIVATE_WORK_ITEM_STATUSES.includes(workItem.status as (typeof PRIVATE_WORK_ITEM_STATUSES)[number]);
}

export function canAckWorkItemSync(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  return canViewWorkItemAssets(workItem, user, scope);
}

export function canAddWorkItemAttachment(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  return isSubmitter(workItem, user) && PRIVATE_WORK_ITEM_STATUSES.includes(workItem.status as never);
}

export function canManageWorkItemAssignees(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  if (isAdmin(user)) {
    return ASSIGNMENT_EDITABLE_STATUSES.has(workItem.status);
  }
  if (!ASSIGNMENT_EDITABLE_STATUSES.has(workItem.status)) {
    return false;
  }
  if (isSubmitter(workItem, user)) {
    return true;
  }
  const lead = leadAssignment(workItem);
  return Boolean(lead && lead.userId === user.id);
}

export function canClaimWorkItem(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  if (isAdmin(user)) {
    return workItem.status === "spec_ready";
  }
  return workItem.status === "spec_ready" && (!hasExplicitAssignees(workItem) || isAssignee(workItem, user));
}

export function canWorkWorkItem(
  workItem: WorkItemAccessRecord,
  user: UserAccessRecord,
  scope?: ResourceScope
): boolean {
  if (!scopeMatches(workItem, scope)) {
    return false;
  }
  if (!workItemProjectIsActive(workItem)) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  return isAssignee(workItem, user);
}

export const canViewRequirementRecord = canViewWorkItemRecord;
export const canViewRequirementAssets = canViewWorkItemAssets;
export const canAckRequirementSync = canAckWorkItemSync;
export const canAddRequirementAttachment = canAddWorkItemAttachment;
export const canManageRequirementAssignees = canManageWorkItemAssignees;
export const canClaimRequirement = canClaimWorkItem;
export const canWorkRequirement = canWorkWorkItem;
