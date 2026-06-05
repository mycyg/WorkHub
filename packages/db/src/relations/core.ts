import { relations } from "drizzle-orm";

import {
  agentRuns,
  agentSteps,
  approvalRequests,
  branches,
  clientDevices,
  comments,
  confidenceRecords,
  deliveries,
  meetingRecords,
  orgs,
  permissionPolicies,
  projectDriveItems,
  projectDriveVersions,
  projects,
  proposals,
  reviews,
  snapshots,
  specDocs,
  users,
  userProfiles,
  workItemAcceptanceItems,
  workItemAssignments,
  workItemTaskItems,
  workItemTaskPlans,
  workItems,
  workspaces
} from "../schema/core.js";

export const usersRelations = relations(users, ({ many, one }) => ({
  devices: many(clientDevices),
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  ownedProjects: many(projects),
  assignments: many(workItemAssignments)
}));

export const orgsRelations = relations(orgs, ({ many }) => ({
  workspaces: many(workspaces),
  permissionPolicies: many(permissionPolicies)
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  org: one(orgs, { fields: [workspaces.orgId], references: [orgs.id] }),
  projects: many(projects),
  permissionPolicies: many(permissionPolicies)
}));

export const projectsRelations = relations(projects, ({ many, one }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  owner: one(users, { fields: [projects.ownerUserId], references: [users.id] }),
  workItems: many(workItems),
  driveItems: many(projectDriveItems)
}));

export const workItemsRelations = relations(workItems, ({ many, one }) => ({
  project: one(projects, { fields: [workItems.projectId], references: [projects.id] }),
  workspace: one(workspaces, { fields: [workItems.workspaceId], references: [workspaces.id] }),
  submitter: one(users, { fields: [workItems.submitterUserId], references: [users.id] }),
  currentSpec: one(specDocs, { fields: [workItems.currentSpecId], references: [specDocs.id] }),
  mainBranch: one(branches, { fields: [workItems.mainBranchId], references: [branches.id] }),
  latestConfidence: one(confidenceRecords, {
    fields: [workItems.latestConfidenceId],
    references: [confidenceRecords.id]
  }),
  assignments: many(workItemAssignments),
  branches: many(branches),
  proposals: many(proposals),
  agentRuns: many(agentRuns),
  acceptanceItems: many(workItemAcceptanceItems),
  taskPlans: many(workItemTaskPlans),
  comments: many(comments)
}));

export const branchesRelations = relations(branches, ({ many, one }) => ({
  workItem: one(workItems, { fields: [branches.workItemId], references: [workItems.id] }),
  actorUser: one(users, { fields: [branches.actorUserId], references: [users.id] }),
  proposals: many(proposals)
}));

export const proposalsRelations = relations(proposals, ({ many, one }) => ({
  workItem: one(workItems, { fields: [proposals.workItemId], references: [workItems.id] }),
  branch: one(branches, { fields: [proposals.branchId], references: [branches.id] }),
  confidence: one(confidenceRecords, { fields: [proposals.confidenceId], references: [confidenceRecords.id] }),
  mergeSnapshot: one(snapshots, { fields: [proposals.mergeSnapshotId], references: [snapshots.id] }),
  reviews: many(reviews),
  deliveries: many(deliveries)
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  proposal: one(proposals, { fields: [reviews.proposalId], references: [proposals.id] }),
  reviewer: one(users, { fields: [reviews.reviewerUserId], references: [users.id] })
}));

export const agentRunsRelations = relations(agentRuns, ({ many, one }) => ({
  workItem: one(workItems, { fields: [agentRuns.workItemId], references: [workItems.id] }),
  branch: one(branches, { fields: [agentRuns.branchId], references: [branches.id] }),
  steps: many(agentSteps),
  approvals: many(approvalRequests)
}));

export const agentStepsRelations = relations(agentSteps, ({ one }) => ({
  run: one(agentRuns, { fields: [agentSteps.agentRunId], references: [agentRuns.id] }),
  snapshot: one(snapshots, { fields: [agentSteps.snapshotId], references: [snapshots.id] })
}));

export const snapshotsRelations = relations(snapshots, ({ one }) => ({
  workItem: one(workItems, { fields: [snapshots.workItemId], references: [workItems.id] }),
  branch: one(branches, { fields: [snapshots.branchId], references: [branches.id] })
}));

export const projectDriveItemsRelations = relations(projectDriveItems, ({ many, one }) => ({
  project: one(projects, { fields: [projectDriveItems.projectId], references: [projects.id] }),
  parent: one(projectDriveItems, { fields: [projectDriveItems.parentId], references: [projectDriveItems.id] }),
  versions: many(projectDriveVersions)
}));

export const workItemTaskPlansRelations = relations(workItemTaskPlans, ({ many, one }) => ({
  workItem: one(workItems, { fields: [workItemTaskPlans.workItemId], references: [workItems.id] }),
  items: many(workItemTaskItems)
}));

export const workItemAcceptanceItemsRelations = relations(workItemAcceptanceItems, ({ one }) => ({
  workItem: one(workItems, { fields: [workItemAcceptanceItems.workItemId], references: [workItems.id] })
}));

export const meetingRecordsRelations = relations(meetingRecords, ({ one }) => ({
  project: one(projects, { fields: [meetingRecords.projectId], references: [projects.id] }),
  workItem: one(workItems, { fields: [meetingRecords.workItemId], references: [workItems.id] })
}));
