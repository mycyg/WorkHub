import { relations } from "drizzle-orm";

import {
  actionCardItems,
  actionCards,
  agentMemory,
  agentMemoryVersions,
  agentRuns,
  agentSteps,
  approvalRequests,
  branches,
  clientDevices,
  comments,
  confidenceRecords,
  conversationMessages,
  conversationObserverState,
  conversationParticipants,
  deliveries,
  meetingRecords,
  keyResults,
  objectiveWorkItemLinks,
  objectives,
  orgs,
  permissionPolicies,
  projectAiGovernance,
  projectConversations,
  projectDriveItems,
  projectDriveVersions,
  projects,
  proposals,
  reviews,
  snapshots,
  specDocs,
  taskPlanItems,
  taskPlans,
  users,
  userAiProfiles,
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
  assignments: many(workItemAssignments),
  createdConversations: many(projectConversations, { relationName: "conversation_created_by" }),
  conversationParticipants: many(conversationParticipants),
  assignedActionCardItems: many(actionCardItems),
  aiProfiles: many(userAiProfiles)
}));

export const orgsRelations = relations(orgs, ({ many }) => ({
  workspaces: many(workspaces),
  permissionPolicies: many(permissionPolicies)
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  org: one(orgs, { fields: [workspaces.orgId], references: [orgs.id] }),
  projects: many(projects),
  taskPlans: many(taskPlans),
  objectives: many(objectives),
  agentMemory: many(agentMemory),
  conversations: many(projectConversations),
  userAiProfiles: many(userAiProfiles),
  permissionPolicies: many(permissionPolicies)
}));

export const projectsRelations = relations(projects, ({ many, one }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  owner: one(users, { fields: [projects.ownerUserId], references: [users.id] }),
  workItems: many(workItems),
  driveItems: many(projectDriveItems),
  conversations: many(projectConversations),
  aiGovernance: one(projectAiGovernance, {
    fields: [projects.id],
    references: [projectAiGovernance.projectId]
  })
}));

export const projectConversationsRelations = relations(projectConversations, ({ many, one }) => ({
  workspace: one(workspaces, { fields: [projectConversations.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [projectConversations.projectId], references: [projects.id] }),
  parent: one(projectConversations, {
    fields: [projectConversations.parentConversationId],
    references: [projectConversations.id],
    relationName: "conversation_parent"
  }),
  children: many(projectConversations, { relationName: "conversation_parent" }),
  sourceMessage: one(conversationMessages, {
    fields: [projectConversations.sourceMessageId],
    references: [conversationMessages.id],
    relationName: "project_conversation_source_message"
  }),
  createdBy: one(users, {
    fields: [projectConversations.createdBy],
    references: [users.id],
    relationName: "conversation_created_by"
  }),
  participants: many(conversationParticipants),
  messages: many(conversationMessages, { relationName: "conversation_messages" }),
  actionCards: many(actionCards),
  observerState: one(conversationObserverState),
  sourceRuns: many(agentRuns)
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(projectConversations, {
    fields: [conversationParticipants.conversationId],
    references: [projectConversations.id]
  }),
  user: one(users, { fields: [conversationParticipants.userId], references: [users.id] })
}));

export const conversationMessagesRelations = relations(conversationMessages, ({ many, one }) => ({
  conversation: one(projectConversations, {
    fields: [conversationMessages.conversationId],
    references: [projectConversations.id],
    relationName: "conversation_messages"
  }),
  senderUser: one(users, { fields: [conversationMessages.senderUserId], references: [users.id] }),
  threadRoot: one(conversationMessages, {
    fields: [conversationMessages.threadRootId],
    references: [conversationMessages.id],
    relationName: "conversation_message_thread"
  }),
  replies: many(conversationMessages, { relationName: "conversation_message_thread" }),
  sourceForConversations: many(projectConversations, { relationName: "project_conversation_source_message" }),
  actionCard: one(actionCards, {
    fields: [conversationMessages.id],
    references: [actionCards.messageId],
    relationName: "conversation_message_action_card"
  })
}));

export const actionCardsRelations = relations(actionCards, ({ many, one }) => ({
  conversation: one(projectConversations, { fields: [actionCards.conversationId], references: [projectConversations.id] }),
  message: one(conversationMessages, {
    fields: [actionCards.messageId],
    references: [conversationMessages.id],
    relationName: "conversation_message_action_card"
  }),
  items: many(actionCardItems),
  observerStates: many(conversationObserverState)
}));

export const actionCardItemsRelations = relations(actionCardItems, ({ many, one }) => ({
  actionCard: one(actionCards, { fields: [actionCardItems.actionCardId], references: [actionCards.id] }),
  workItem: one(workItems, { fields: [actionCardItems.workItemId], references: [workItems.id] }),
  run: one(agentRuns, {
    fields: [actionCardItems.runId],
    references: [agentRuns.id],
    relationName: "action_card_item_run"
  }),
  assignee: one(users, { fields: [actionCardItems.assigneeUserId], references: [users.id] }),
  sourceRuns: many(agentRuns, { relationName: "agent_run_source_action_card_item" })
}));

export const conversationObserverStateRelations = relations(conversationObserverState, ({ one }) => ({
  conversation: one(projectConversations, {
    fields: [conversationObserverState.conversationId],
    references: [projectConversations.id]
  }),
  activeCard: one(actionCards, { fields: [conversationObserverState.activeCardId], references: [actionCards.id] })
}));

export const userAiProfilesRelations = relations(userAiProfiles, ({ one }) => ({
  workspace: one(workspaces, { fields: [userAiProfiles.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [userAiProfiles.userId], references: [users.id] })
}));

export const projectAiGovernanceRelations = relations(projectAiGovernance, ({ one }) => ({
  project: one(projects, { fields: [projectAiGovernance.projectId], references: [projects.id] })
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
  agentTaskPlans: many(taskPlans),
  objectiveLinks: many(objectiveWorkItemLinks),
  taskPlans: many(workItemTaskPlans),
  comments: many(comments),
  actionCardItems: many(actionCardItems)
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
  actorUser: one(users, { fields: [agentRuns.actorUserId], references: [users.id] }),
  sourceConversation: one(projectConversations, {
    fields: [agentRuns.sourceConversationId],
    references: [projectConversations.id]
  }),
  sourceActionCardItem: one(actionCardItems, {
    fields: [agentRuns.sourceActionCardItemId],
    references: [actionCardItems.id],
    relationName: "agent_run_source_action_card_item"
  }),
  actionCardItems: many(actionCardItems, { relationName: "action_card_item_run" }),
  steps: many(agentSteps),
  agentMemory: many(agentMemory),
  agentMemoryVersions: many(agentMemoryVersions),
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

export const taskPlansRelations = relations(taskPlans, ({ many, one }) => ({
  workItem: one(workItems, { fields: [taskPlans.workItemId], references: [workItems.id] }),
  workspace: one(workspaces, { fields: [taskPlans.workspaceId], references: [workspaces.id] }),
  objective: one(objectives, { fields: [taskPlans.objectiveId], references: [objectives.id] }),
  createdBy: one(users, { fields: [taskPlans.createdByUserId], references: [users.id] }),
  items: many(taskPlanItems)
}));

export const taskPlanItemsRelations = relations(taskPlanItems, ({ many, one }) => ({
  plan: one(taskPlans, { fields: [taskPlanItems.planId], references: [taskPlans.id] }),
  parentItem: one(taskPlanItems, {
    fields: [taskPlanItems.parentItemId],
    references: [taskPlanItems.id],
    relationName: "task_plan_item_parent"
  }),
  agentMemory: many(agentMemory)
}));

export const agentMemoryRelations = relations(agentMemory, ({ many, one }) => ({
  workspace: one(workspaces, { fields: [agentMemory.workspaceId], references: [workspaces.id] }),
  taskPlanItem: one(taskPlanItems, { fields: [agentMemory.agentContextId], references: [taskPlanItems.id] }),
  sourceRun: one(agentRuns, { fields: [agentMemory.sourceRunId], references: [agentRuns.id] }),
  versions: many(agentMemoryVersions)
}));

export const agentMemoryVersionsRelations = relations(agentMemoryVersions, ({ one }) => ({
  memory: one(agentMemory, { fields: [agentMemoryVersions.memoryId], references: [agentMemory.id] }),
  sourceRun: one(agentRuns, { fields: [agentMemoryVersions.sourceRunId], references: [agentRuns.id] })
}));

export const objectivesRelations = relations(objectives, ({ many, one }) => ({
  workspace: one(workspaces, { fields: [objectives.workspaceId], references: [workspaces.id] }),
  owner: one(users, { fields: [objectives.ownerUserId], references: [users.id] }),
  keyResults: many(keyResults),
  workItemLinks: many(objectiveWorkItemLinks),
  taskPlans: many(taskPlans)
}));

export const keyResultsRelations = relations(keyResults, ({ one }) => ({
  objective: one(objectives, { fields: [keyResults.objectiveId], references: [objectives.id] }),
  workspace: one(workspaces, { fields: [keyResults.workspaceId], references: [workspaces.id] })
}));

export const objectiveWorkItemLinksRelations = relations(objectiveWorkItemLinks, ({ one }) => ({
  workspace: one(workspaces, { fields: [objectiveWorkItemLinks.workspaceId], references: [workspaces.id] }),
  objective: one(objectives, { fields: [objectiveWorkItemLinks.objectiveId], references: [objectives.id] }),
  workItem: one(workItems, { fields: [objectiveWorkItemLinks.workItemId], references: [workItems.id] }),
  linkedBy: one(users, { fields: [objectiveWorkItemLinks.linkedByUserId], references: [users.id] })
}));

export const workItemAcceptanceItemsRelations = relations(workItemAcceptanceItems, ({ one }) => ({
  workItem: one(workItems, { fields: [workItemAcceptanceItems.workItemId], references: [workItems.id] })
}));

export const meetingRecordsRelations = relations(meetingRecords, ({ one }) => ({
  project: one(projects, { fields: [meetingRecords.projectId], references: [projects.id] }),
  workItem: one(workItems, { fields: [meetingRecords.workItemId], references: [workItems.id] })
}));
