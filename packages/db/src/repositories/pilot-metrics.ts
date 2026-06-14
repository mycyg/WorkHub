import type { CostLedgerEntry } from "@workhub/cost";
import { gte, or, type SQL } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  approvalRequests,
  escalationEvents,
  mergeAttempts,
  notifications,
  proposals,
  reviews,
  workItems
} from "../schema/index.js";
import { createDbCostLedgerStore } from "./cost-ledger.js";

export type PilotDay1WorkItemMetricRow = {
  id: string;
  code: string;
  submitterUserId: string;
  createdAt: Date;
};

export type PilotDay1ProposalMetricRow = {
  id: string;
  workItemId: string;
  status: string;
  openedByKind: string;
  openedByUserId: string | null;
  reviewedAt: Date | null;
  mergedAt: Date | null;
  createdAt: Date;
};

export type PilotDay1ReviewMetricRow = {
  id: string;
  proposalId: string;
  reviewerUserId: string | null;
  decision: string;
  createdAt: Date;
};

export type PilotDay1AgentRunMetricRow = {
  id: string;
  workItemId: string;
  actorUserId: string | null;
  status: string;
  tokenIn: number;
  tokenOut: number;
  costEstimate: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export type PilotDay1EscalationMetricRow = {
  id: string;
  workItemId: string;
  agentRunId: string | null;
  trigger: string;
  createdAt: Date;
};

export type PilotDay1ApprovalMetricRow = {
  id: string;
  workItemId: string | null;
  agentRunId: string | null;
  status: string;
  routedToUserId: string | null;
  decidedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PilotDay1MergeAttemptMetricRow = {
  id: string;
  proposalId: string;
  workItemId: string;
  result: string;
  conflictCount: number;
  createdAt: Date;
};

export type PilotDay1NotificationMetricRow = {
  id: string;
  userId: string;
  type: string;
  severity: string;
  createdAt: Date;
};

export type PilotDay1MetricsRows = {
  workItems: PilotDay1WorkItemMetricRow[];
  proposals: PilotDay1ProposalMetricRow[];
  reviews: PilotDay1ReviewMetricRow[];
  agentRuns: PilotDay1AgentRunMetricRow[];
  escalationEvents: PilotDay1EscalationMetricRow[];
  approvalRequests: PilotDay1ApprovalMetricRow[];
  mergeAttempts: PilotDay1MergeAttemptMetricRow[];
  notifications: PilotDay1NotificationMetricRow[];
  costLedgerEntries: readonly CostLedgerEntry[];
};

// 首页 AI 战绩只需要这两张表的今日切片——不再为 4 个数字全表扫 9 张表（M5）。
export type AiWorklogMetricsRows = {
  agentRuns: PilotDay1AgentRunMetricRow[];
  proposals: PilotDay1ProposalMetricRow[];
};

export type PilotMetricsRepository = {
  readDay1MetricsRows: () => Promise<PilotDay1MetricsRows>;
  readAiWorklogRows: (since: Date) => Promise<AiWorklogMetricsRows>;
};

export function createPilotMetricsRepository(db: WorkHubDb): PilotMetricsRepository {
  return {
    async readDay1MetricsRows() {
      const ledgerStore = createDbCostLedgerStore(db);
      const [
        workItemRows,
        proposalRows,
        reviewRows,
        agentRunRows,
        escalationRows,
        approvalRows,
        mergeAttemptRows,
        notificationRows,
        costLedgerEntries
      ] = await Promise.all([
        db.select({
          id: workItems.id,
          code: workItems.code,
          submitterUserId: workItems.submitterUserId,
          createdAt: workItems.createdAt
        }).from(workItems),
        db.select({
          id: proposals.id,
          workItemId: proposals.workItemId,
          status: proposals.status,
          openedByKind: proposals.openedByKind,
          openedByUserId: proposals.openedByUserId,
          reviewedAt: proposals.reviewedAt,
          mergedAt: proposals.mergedAt,
          createdAt: proposals.createdAt
        }).from(proposals),
        db.select({
          id: reviews.id,
          proposalId: reviews.proposalId,
          reviewerUserId: reviews.reviewerUserId,
          decision: reviews.decision,
          createdAt: reviews.createdAt
        }).from(reviews),
        db.select({
          id: agentRuns.id,
          workItemId: agentRuns.workItemId,
          actorUserId: agentRuns.actorUserId,
          status: agentRuns.status,
          tokenIn: agentRuns.tokenIn,
          tokenOut: agentRuns.tokenOut,
          costEstimate: agentRuns.costEstimate,
          createdAt: agentRuns.createdAt,
          finishedAt: agentRuns.finishedAt
        }).from(agentRuns),
        db.select({
          id: escalationEvents.id,
          workItemId: escalationEvents.workItemId,
          agentRunId: escalationEvents.agentRunId,
          trigger: escalationEvents.trigger,
          createdAt: escalationEvents.createdAt
        }).from(escalationEvents),
        db.select({
          id: approvalRequests.id,
          workItemId: approvalRequests.workItemId,
          agentRunId: approvalRequests.agentRunId,
          status: approvalRequests.status,
          routedToUserId: approvalRequests.routedToUserId,
          decidedByUserId: approvalRequests.decidedByUserId,
          createdAt: approvalRequests.createdAt,
          updatedAt: approvalRequests.updatedAt
        }).from(approvalRequests),
        db.select({
          id: mergeAttempts.id,
          proposalId: mergeAttempts.proposalId,
          workItemId: mergeAttempts.workItemId,
          result: mergeAttempts.result,
          conflictCount: mergeAttempts.conflictCount,
          createdAt: mergeAttempts.createdAt
        }).from(mergeAttempts),
        db.select({
          id: notifications.id,
          userId: notifications.userId,
          type: notifications.type,
          severity: notifications.severity,
          createdAt: notifications.createdAt
        }).from(notifications),
        ledgerStore.listEntries ? ledgerStore.listEntries() : []
      ]);

      return {
        workItems: workItemRows,
        proposals: proposalRows,
        reviews: reviewRows,
        agentRuns: agentRunRows,
        escalationEvents: escalationRows,
        approvalRequests: approvalRows,
        mergeAttempts: mergeAttemptRows,
        notifications: notificationRows,
        costLedgerEntries
      };
    },

    async readAiWorklogRows(since: Date) {
      const [agentRunRows, proposalRows] = await Promise.all([
        db.select({
          id: agentRuns.id,
          workItemId: agentRuns.workItemId,
          actorUserId: agentRuns.actorUserId,
          status: agentRuns.status,
          tokenIn: agentRuns.tokenIn,
          tokenOut: agentRuns.tokenOut,
          costEstimate: agentRuns.costEstimate,
          createdAt: agentRuns.createdAt,
          finishedAt: agentRuns.finishedAt
        }).from(agentRuns).where(
          or(gte(agentRuns.createdAt, since), gte(agentRuns.finishedAt, since)) as SQL
        ),
        db.select({
          id: proposals.id,
          workItemId: proposals.workItemId,
          status: proposals.status,
          openedByKind: proposals.openedByKind,
          openedByUserId: proposals.openedByUserId,
          reviewedAt: proposals.reviewedAt,
          mergedAt: proposals.mergedAt,
          createdAt: proposals.createdAt
        }).from(proposals).where(gte(proposals.mergedAt, since))
      ]);
      return { agentRuns: agentRunRows, proposals: proposalRows };
    }
  };
}
