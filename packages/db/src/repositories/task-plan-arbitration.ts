import { and, asc, eq, inArray } from "drizzle-orm";

import type { DeliverableChangeManifest } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  branches,
  proposals,
  taskPlanItems
} from "../schema/index.js";

export type TaskPlanArbitrationCandidateRow = {
  proposalId: string;
  proposalTitle: string;
  manifest: DeliverableChangeManifest;
  runId: string;
  runModel: string;
  budgetDecisionJson: unknown;
  taskPlanItemId?: string | null;
};

export type TaskPlanArbitrationRepository = {
  listCandidates: (input: {
    planId: string;
    workspaceId: string;
    workItemId: string;
    limit: number;
  }) => Promise<TaskPlanArbitrationCandidateRow[]>;
};

export function createTaskPlanArbitrationRepository(db: WorkHubDb): TaskPlanArbitrationRepository {
  return {
    async listCandidates(input) {
      return db
        .select({
          proposalId: proposals.id,
          proposalTitle: proposals.title,
          manifest: proposals.diffManifest,
          runId: agentRuns.id,
          runModel: agentRuns.model,
          budgetDecisionJson: agentRuns.budgetDecisionJson,
          taskPlanItemId: agentRuns.taskPlanItemId
        })
        .from(agentRuns)
        .innerJoin(taskPlanItems, and(
          eq(taskPlanItems.id, agentRuns.taskPlanItemId),
          eq(taskPlanItems.planId, input.planId)
        ))
        .innerJoin(branches, and(
          eq(branches.agentRunId, agentRuns.id),
          eq(branches.workItemId, input.workItemId)
        ))
        .innerJoin(proposals, and(
          eq(proposals.branchId, branches.id),
          eq(proposals.workItemId, input.workItemId),
          inArray(proposals.status, ["opened", "reviewed"])
        ))
        .where(and(
          eq(agentRuns.taskPlanId, input.planId),
          eq(agentRuns.workspaceId, input.workspaceId),
          eq(agentRuns.workItemId, input.workItemId),
          eq(agentRuns.status, "succeeded")
        ))
        .orderBy(asc(taskPlanItems.seq), asc(agentRuns.createdAt), asc(proposals.createdAt), asc(proposals.id))
        .limit(input.limit);
    }
  };
}
