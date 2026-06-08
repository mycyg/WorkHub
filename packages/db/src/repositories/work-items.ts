import { and, eq, inArray, sql } from "drizzle-orm";

import type { WorkItemMode, WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { projects, workItems } from "../schema/index.js";

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

export type WorkItemRepository = {
  findWorkItemForHumanReservedGuard: (workItemId: string) => Promise<WorkItemHumanReservedRow | null>;
  findWorkItemForNotificationContext: (workItemId: string) => Promise<WorkItemNotificationContextRow | null>;
  markHumanReservedPmMode: (input: {
    workItemId: string;
    at: Date;
  }) => Promise<WorkItemHumanReservedRow | null>;
};

export function createWorkItemRepository(db: WorkHubDb): WorkItemRepository {
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
    }
  };
}
