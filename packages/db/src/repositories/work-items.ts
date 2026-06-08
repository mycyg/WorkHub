import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import type { EvidenceRef, WorkItemMode, WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  agentSteps,
  chatMessages,
  knowledgeDocuments,
  projects,
  proposals,
  workItemAcceptanceItems,
  workItems
} from "../schema/index.js";
import { allocateProjectCode } from "../sequences.js";

const humanReservedGuardColumns = {
  id: workItems.id,
  code: workItems.code,
  title: workItems.title,
  status: workItems.status,
  mode: workItems.mode,
  humanReserved: workItems.humanReserved,
  submitterUserId: workItems.submitterUserId,
  claimedByUserId: workItems.claimedByUserId
};

const notificationContextColumns = {
  id: workItems.id,
  code: workItems.code,
  title: workItems.title,
  projectId: workItems.projectId,
  submitterUserId: workItems.submitterUserId,
  claimedByUserId: workItems.claimedByUserId,
  projectOwnerUserId: projects.ownerUserId
};

const pmModeEligibleStatuses = ["spec_ready", "ai_working", "escalated", "pm_mode", "in_review"] as const;

export type WorkItemHumanReservedRow = {
  id: string;
  code: string;
  title: string | null;
  status: WorkItemStatus;
  mode: WorkItemMode;
  humanReserved: boolean;
  submitterUserId: string;
  claimedByUserId: string | null;
};

export type WorkItemNotificationContextRow = {
  id: string;
  code: string;
  title: string | null;
  projectId: string;
  submitterUserId: string;
  claimedByUserId: string | null;
  projectOwnerUserId: string | null;
};

export type WorkItemProjectRow = typeof projects.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkItemAcceptanceRow = typeof workItemAcceptanceItems.$inferSelect;
export type WorkItemAgentStepRow = typeof agentSteps.$inferSelect;
export type WorkItemProposalRow = typeof proposals.$inferSelect;
export type WorkItemChatMessageRow = typeof chatMessages.$inferSelect;
export type WorkItemKnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect;

export type CreateStoredWorkItemInput = {
  id?: string;
  projectId: string;
  workspaceId?: string | null;
  submitterUserId: string;
  title?: string | null;
  rawDescription?: string | null;
  summaryMd?: string | null;
  status?: WorkItemStatus;
  priority?: string;
  mode?: WorkItemMode;
  selectedOptionIds?: string[];
  at?: Date;
};

export type UpdateStoredWorkItemFromSessionInput = {
  workItemId: string;
  title?: string;
  rawDescription?: string;
  summaryMd?: string;
  status: WorkItemStatus;
  selectedOptionIds?: string[];
  at?: Date;
};

export type InsertStoredChatMessageInput = {
  id?: string;
  workItemId: string;
  role: "user" | "assistant" | "system";
  kind: string;
  contentJson: Record<string, unknown>;
  selectedOptionKey?: string;
  userOtherText?: string;
  at?: Date;
};

export type StoredWorkItemDetailRows = {
  workItem: WorkItemRow;
  projectOwnerUserId: string | null;
  acceptance: WorkItemAcceptanceRow[];
  agentSteps: WorkItemAgentStepRow[];
  latestProposal: WorkItemProposalRow | null;
  evidenceBindings: WorkItemChatMessageRow[];
};

export type WorkItemKnowledgeSearchInput = {
  query?: string;
  projectId?: string;
  workItemId?: string;
  limit?: number;
};

export type WorkItemKnowledgeSearchRows = {
  documents: WorkItemKnowledgeDocumentRow[];
  workItems: WorkItemRow[];
};

export type WorkItemRepository = {
  findWorkItemForHumanReservedGuard: (workItemId: string) => Promise<WorkItemHumanReservedRow | null>;
  findWorkItemForNotificationContext: (workItemId: string) => Promise<WorkItemNotificationContextRow | null>;
  markHumanReservedPmMode: (input: {
    workItemId: string;
    at: Date;
  }) => Promise<WorkItemHumanReservedRow | null>;
};

export type WorkItemDataRepository = WorkItemRepository & {
  findProjectById: (projectId: string) => Promise<WorkItemProjectRow | null>;
  findFirstActiveProject: () => Promise<WorkItemProjectRow | null>;
  createWorkItem: (input: CreateStoredWorkItemInput) => Promise<WorkItemRow>;
  updateWorkItemFromSession: (input: UpdateStoredWorkItemFromSessionInput) => Promise<WorkItemRow | null>;
  insertChatMessage: (input: InsertStoredChatMessageInput) => Promise<WorkItemChatMessageRow>;
  findWorkItemById: (workItemId: string) => Promise<WorkItemRow | null>;
  readWorkItemDetail: (workItemId: string) => Promise<StoredWorkItemDetailRows | null>;
  searchKnowledge: (input: WorkItemKnowledgeSearchInput) => Promise<WorkItemKnowledgeSearchRows>;
};

const trueCondition = sql`true`;

function whereAll(conditions: SQL[]) {
  return conditions.length > 0 ? and(...conditions) : trueCondition;
}

export function createWorkItemRepository(db: WorkHubDb): WorkItemDataRepository {
  return {
    async findWorkItemForHumanReservedGuard(workItemId) {
      const rows = await db
        .select(humanReservedGuardColumns)
        .from(workItems)
        .where(eq(workItems.id, workItemId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findWorkItemForNotificationContext(workItemId) {
      const rows = await db
        .select(notificationContextColumns)
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(workItems.id, workItemId))
        .limit(1);
      return rows[0] ?? null;
    },

    async markHumanReservedPmMode(input) {
      const rows = await db
        .update(workItems)
        .set({
          status: "pm_mode",
          mode: "pm",
          version: sql`${workItems.version} + 1`,
          updatedAt: input.at
        })
        .where(
          and(
            eq(workItems.id, input.workItemId),
            eq(workItems.humanReserved, true),
            inArray(workItems.status, pmModeEligibleStatuses)
          )
        )
        .returning(humanReservedGuardColumns);
      return rows[0] ?? null;
    },

    async findProjectById(projectId) {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.archived, false), isNull(projects.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findFirstActiveProject() {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.archived, false), isNull(projects.deletedAt)))
        .orderBy(asc(projects.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async createWorkItem(input) {
      const at = input.at ?? new Date();
      const allocation = await allocateProjectCode(db, input.projectId);
      const values: typeof workItems.$inferInsert = {
          id: input.id ?? randomUUID(),
          code: allocation.code,
          projectId: input.projectId,
          submitterUserId: input.submitterUserId,
          status: input.status ?? "intake",
          priority: input.priority ?? "normal",
          mode: input.mode ?? "worker",
          humanReserved: false,
          createdAt: at,
          updatedAt: at
        };
      if (input.workspaceId) values.workspaceId = input.workspaceId;
      if (input.title) values.title = input.title;
      if (input.rawDescription) values.rawDescription = input.rawDescription;
      if (input.summaryMd) values.summaryMd = input.summaryMd;
      if (input.selectedOptionIds?.length) {
        values.planningNote = `selected_options: ${input.selectedOptionIds.join(",")}`;
      }
      const rows = await db
        .insert(workItems)
        .values(values)
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create work item");
      }
      return row;
    },

    async updateWorkItemFromSession(input) {
      const at = input.at ?? new Date();
      const rows = await db
        .update(workItems)
        .set({
          ...(input.title ? { title: input.title } : {}),
          ...(input.rawDescription ? { rawDescription: input.rawDescription } : {}),
          ...(input.summaryMd ? { summaryMd: input.summaryMd } : {}),
          status: input.status,
          planningNote: input.selectedOptionIds?.length
            ? `selected_options: ${input.selectedOptionIds.join(",")}`
            : undefined,
          version: sql`${workItems.version} + 1`,
          updatedAt: at
        })
        .where(eq(workItems.id, input.workItemId))
        .returning();
      return rows[0] ?? null;
    },

    async insertChatMessage(input) {
      const at = input.at ?? new Date();
      const values: typeof chatMessages.$inferInsert = {
          id: input.id ?? randomUUID(),
          workItemId: input.workItemId,
          role: input.role,
          kind: input.kind,
          contentJson: input.contentJson,
          createdAt: at,
          updatedAt: at
        };
      if (input.selectedOptionKey) values.selectedOptionKey = input.selectedOptionKey;
      if (input.userOtherText) values.userOtherText = input.userOtherText;
      const rows = await db
        .insert(chatMessages)
        .values(values)
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create chat message");
      }
      return row;
    },

    async findWorkItemById(workItemId) {
      const rows = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
      return rows[0] ?? null;
    },

    async readWorkItemDetail(workItemId) {
      const rows = await db
        .select({
          workItem: workItems,
          projectOwnerUserId: projects.ownerUserId
        })
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(workItems.id, workItemId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }

      const latestRunRows = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.workItemId, workItemId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      const latestRunId = latestRunRows[0]?.id;
      const agentStepRows = latestRunId
        ? await db
            .select()
            .from(agentSteps)
            .where(eq(agentSteps.agentRunId, latestRunId))
            .orderBy(asc(agentSteps.seq), asc(agentSteps.createdAt))
            .limit(8)
        : [];

      const [acceptance, latestProposals, evidenceBindings] = await Promise.all([
        db
          .select()
          .from(workItemAcceptanceItems)
          .where(eq(workItemAcceptanceItems.workItemId, workItemId))
          .orderBy(asc(workItemAcceptanceItems.sortOrder), asc(workItemAcceptanceItems.createdAt)),
        db
          .select()
          .from(proposals)
          .where(eq(proposals.workItemId, workItemId))
          .orderBy(desc(proposals.createdAt))
          .limit(1),
        db
          .select()
          .from(chatMessages)
          .where(and(eq(chatMessages.workItemId, workItemId), eq(chatMessages.kind, "evidence_binding")))
          .orderBy(desc(chatMessages.createdAt))
          .limit(20)
      ]);

      return {
        workItem: row.workItem,
        projectOwnerUserId: row.projectOwnerUserId,
        acceptance,
        agentSteps: agentStepRows,
        latestProposal: latestProposals[0] ?? null,
        evidenceBindings
      };
    },

    async searchKnowledge(input) {
      const query = input.query?.trim();
      const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
      const pattern = query ? `%${query}%` : undefined;
      const documentConditions: SQL[] = [];
      const workItemConditions: SQL[] = [isNull(workItems.deletedAt)];

      if (input.projectId) {
        documentConditions.push(eq(knowledgeDocuments.projectId, input.projectId));
        workItemConditions.push(eq(workItems.projectId, input.projectId));
      }
      if (input.workItemId) {
        documentConditions.push(eq(knowledgeDocuments.workItemId, input.workItemId));
        workItemConditions.push(eq(workItems.id, input.workItemId));
      }
      if (pattern) {
        documentConditions.push(
          or(
            ilike(knowledgeDocuments.title, pattern),
            ilike(knowledgeDocuments.sourceId, pattern),
            ilike(knowledgeDocuments.sourceUrl, pattern)
          ) ?? trueCondition
        );
        workItemConditions.push(
          or(
            ilike(workItems.code, pattern),
            ilike(workItems.title, pattern),
            ilike(workItems.rawDescription, pattern),
            ilike(workItems.summaryMd, pattern)
          ) ?? trueCondition
        );
      }

      const [documents, workItemRows] = await Promise.all([
        db
          .select()
          .from(knowledgeDocuments)
          .where(whereAll(documentConditions))
          .orderBy(desc(knowledgeDocuments.updatedAt))
          .limit(limit),
        db
          .select()
          .from(workItems)
          .where(whereAll(workItemConditions))
          .orderBy(desc(workItems.updatedAt))
          .limit(limit)
      ]);

      return {
        documents,
        workItems: workItemRows
      };
    }
  };
}
