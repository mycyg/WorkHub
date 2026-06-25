import type { CostLedgerEntry } from "@workhub/cost";
import { and, eq, gte, inArray, isNull, or, type AnyColumn, type SQL } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  approvalRequests,
  auditLogs,
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

// R8：今日技能自进化事件（按审计动作；新增 = distilled_and_promoted，精修 = refined_via_patch）。
export type SkillCurationEventRow = { action: string };

// 首页 AI 战绩只需要这几张表的今日切片——不再为几个数字全表扫 9 张表（M5）。
export type AiWorklogMetricsRows = {
  agentRuns: PilotDay1AgentRunMetricRow[];
  proposals: PilotDay1ProposalMetricRow[];
  skillCurationEvents: SkillCurationEventRow[];
};

// AUTHZ-2：今日 AI 战绩按工作区收口。这些表的 workspace_id 是后加的可空列,历史行大量为 NULL
// (本机真库 44 条 agent_run 里 43 条 workspace_id IS NULL)——直接 eq 会把首页横幅从 ~44 砍到 ~1。
// 因此区分:
//   - includeUntagged=true(请求者在默认工作区):未打标(NULL)的历史行视为默认工作区数据,一并计入;
//   - includeUntagged=false(请求者在非默认工作区):只认显式打了本工作区标的行,NULL 不归你(闭合跨租户泄露)。
// 不传 scope=完全不过滤(向后兼容旧调用/单测)。proposals 表无 workspace_id 列,经 work_items 联表取它的工作区。
export type AiWorklogScope = {
  workspaceId: string;
  includeUntagged: boolean;
};

export type PilotMetricsRepository = {
  readDay1MetricsRows: () => Promise<PilotDay1MetricsRows>;
  readAiWorklogRows: (since: Date, scope?: AiWorklogScope) => Promise<AiWorklogMetricsRows>;
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

    async readAiWorklogRows(since: Date, scope?: AiWorklogScope) {
      // 见 AiWorklogScope 注释:不传 scope=不过滤;默认工作区把 NULL 历史行一并计入;非默认工作区只认显式打标行。
      const inWorkspace = (col: AnyColumn) => {
        if (!scope) {
          return undefined;
        }
        const match = eq(col, scope.workspaceId);
        return scope.includeUntagged ? or(match, isNull(col)) : match;
      };
      const [agentRunRows, proposalRows, skillCurationEvents] = await Promise.all([
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
          and(or(gte(agentRuns.createdAt, since), gte(agentRuns.finishedAt, since)), inWorkspace(agentRuns.workspaceId)) as SQL
        ),
        // proposals 无 workspace_id,经 work_items 内联取工作区(work_item FK notNull,内联不会丢活 proposal)。
        db.select({
          id: proposals.id,
          workItemId: proposals.workItemId,
          status: proposals.status,
          openedByKind: proposals.openedByKind,
          openedByUserId: proposals.openedByUserId,
          reviewedAt: proposals.reviewedAt,
          mergedAt: proposals.mergedAt,
          createdAt: proposals.createdAt
        }).from(proposals)
          .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
          .where(and(gte(proposals.mergedAt, since), inWorkspace(workItems.workspaceId)) as SQL),
        // R8：今日技能自进化（新增 + 精修）——从审计日志按动作取。
        db.select({ action: auditLogs.action }).from(auditLogs).where(
          and(
            gte(auditLogs.createdAt, since),
            inArray(auditLogs.action, ["team_skill.distilled_and_promoted", "team_skill.refined_via_patch"]),
            inWorkspace(auditLogs.workspaceId)
          ) as SQL
        )
      ]);
      return { agentRuns: agentRunRows, proposals: proposalRows, skillCurationEvents };
    }
  };
}
