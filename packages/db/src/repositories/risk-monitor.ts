import { and, asc, eq, gte, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import type { WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  costLedgerEntries,
  notifications,
  projectAiGovernance,
  projectConversations,
  projects,
  workItems
} from "../schema/index.js";

// R14 批 RISK（风险预警巡检，见 r14-release-readiness/05-risk-design.md §3）：三条只读批量查询，
// 全部零 N+1（一次 SQL 拿一批候选/一批工单/一批成本桶），阈值比较全部留在应用层
// （apps/api/src/services/risk-monitor.ts），这层只负责把数据老老实实搬出来。

// 「工单已经在动」= 不在早期澄清阶段（intake/ai_clarifying/spec_ready 之后），照
// work-items.ts 的 privateWorkItemStatuses 同一份语义值（该文件未导出，这里按同样字面量独立声明，
// 避免仅为三个字面量字符串跨仓库导出增加耦合）。
const EARLY_STAGE_WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["intake", "ai_clarifying", "spec_ready"];
// 「工单已经收尾」= 终态，不再计入停滞/临期巡检——照 work-items.ts 的 terminalWorkItemStatuses 同一份
// 语义值（同上，未导出，独立声明）。
const TERMINAL_WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["done", "cancelled", "merged"];

export type RiskMonitorProjectCandidateRow = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  ownerUserId: string;
  ownerNickname: string;
  // main 会话理论上恒存在（ensureActiveMain 建项目时必建），null 是防御性兜底（legacy 数据）。
  mainConversationId: string | null;
  riskMonitorJson: Record<string, unknown> | null;
};

export type ListProjectsPendingDigestInput = {
  // UTC 自然日字符串（YYYY-MM-DD）——既是 dedupeKey 的一部分，也是「今天发过了吗」反连接的判定键。
  utcDate: string;
  limit: number;
};

// §3.1：候选项目——一次 SQL 拿到 governance 阈值 + 主区会话 id + 「今天是否已经发过 digest」的
// 反连接结果。个人空间（is_personal=true）、已归档/已删除、无主（legacy owner_user_id/workspace_id
// 为空）、risk_monitor.enabled=false 的项目天然被排除，不产出候选（不是巡检时跳过，是压根不出现）。
export async function listProjectsPendingDigest(
  db: WorkHubDb,
  input: ListProjectsPendingDigestInput
): Promise<RiskMonitorProjectCandidateRow[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      workspaceId: projects.workspaceId,
      ownerUserId: projects.ownerUserId,
      ownerNickname: projects.ownerNickname,
      mainConversationId: projectConversations.id,
      riskMonitorJson: projectAiGovernance.riskMonitorJson
    })
    .from(projects)
    .leftJoin(projectAiGovernance, eq(projectAiGovernance.projectId, projects.id))
    .leftJoin(
      projectConversations,
      and(
        eq(projectConversations.projectId, projects.id),
        eq(projectConversations.kind, "main"),
        isNull(projectConversations.deletedAt)
      )
    )
    .where(
      and(
        eq(projects.archived, false),
        isNull(projects.deletedAt),
        eq(projects.isPersonal, false),
        isNotNull(projects.ownerUserId),
        // schema 上 workspace_id 可空（历史遗留列），实际活跃项目恒有值——加这道过滤保证下面的返回
        // 类型可以诚实标 string（非 string | null），不是设计伪代码原文的一部分，纯粹的类型安全防御。
        isNotNull(projects.workspaceId),
        sql`coalesce((${projectAiGovernance.riskMonitorJson}->>'enabled')::boolean, true) = true`,
        sql`not exists (
          select 1
          from ${notifications}
          where ${notifications.userId} = ${projects.ownerUserId}
            and ${notifications.dedupeKey} = 'risk-digest:' || ${projects.id}::text || ':' || ${input.utcDate}
        )`
      )
    )
    .orderBy(asc(projects.id))
    .limit(input.limit);

  // flatMap 而不是 map + 断言：owner_user_id/workspace_id 已经在 SQL 里 isNotNull 过滤，这里的 null
  // 分支结构上不可达，但用类型收窄换掉非空断言（!），比 as string 更诚实。
  return rows.flatMap((row) => {
    if (!row.ownerUserId || !row.workspaceId) {
      return [];
    }
    return [
      {
        projectId: row.projectId,
        projectName: row.projectName,
        workspaceId: row.workspaceId,
        ownerUserId: row.ownerUserId,
        ownerNickname: row.ownerNickname,
        mainConversationId: row.mainConversationId,
        riskMonitorJson: row.riskMonitorJson
      }
    ];
  });
}

export type RiskMonitorOpenWorkItemRow = {
  projectId: string;
  id: string;
  code: string;
  title: string | null;
  status: WorkItemStatus;
  updatedAt: Date;
  dueAt: Date | null;
};

export type ListOpenWorkItemAgesInput = {
  projectIds: string[];
  // 安全网上限（如 500）——不是逐项目 cap，是这批候选项目合计的硬顶，超限即诚实少报，不做无界扫描。
  capPerBatch: number;
};

// §3.2：跨候选项目一次批量查询非终态工单，排除挂着 active（queued/running）agent_runs 的工单——
// 一个正在被军团执行的工单，updated_at 可能好几天没动，这不是「停滞」，是「AI 正忙」。阈值比较
// （停滞天数/deadline 前瞻窗口）留给应用层按各项目自己的 risk_monitor 设置分桶判定。
export async function listOpenWorkItemAges(
  db: WorkHubDb,
  input: ListOpenWorkItemAgesInput
): Promise<RiskMonitorOpenWorkItemRow[]> {
  if (input.projectIds.length === 0) {
    return [];
  }
  return db
    .select({
      projectId: workItems.projectId,
      id: workItems.id,
      code: workItems.code,
      title: workItems.title,
      status: workItems.status,
      updatedAt: workItems.updatedAt,
      dueAt: workItems.dueAt
    })
    .from(workItems)
    .where(
      and(
        inArray(workItems.projectId, input.projectIds),
        isNull(workItems.deletedAt),
        notInArray(workItems.status, [...TERMINAL_WORK_ITEM_STATUSES]),
        sql`not exists (
          select 1
          from ${agentRuns}
          where ${agentRuns.workItemId} = ${workItems.id}
            and ${agentRuns.status} in ('queued', 'running')
        )`
      )
    )
    .orderBy(asc(workItems.projectId), asc(workItems.updatedAt))
    .limit(input.capPerBatch);
}

export { EARLY_STAGE_WORK_ITEM_STATUSES, TERMINAL_WORK_ITEM_STATUSES };

export type RiskMonitorDailyCostRow = {
  projectId: string;
  periodBucket: string;
  costCny: string;
};

export type ListDailyCostByProjectsInput = {
  projectIds: string[];
  // 8 天前的 UTC 日期（今天 + 7 日基线），见服务层 §3.4 的 todayCost/baselineAvg 拆分。
  sinceBucket: string;
};

// §3.4：项目级日成本——cost_ledger_entries 本身没有 project_id，JOIN work_items 拿；照
// listCostByAssigneeForWorkspace 的既有手法（一次 GROUP BY 查询出账，不在应用层循环）。只认
// scope_kind='workitem' 的行（同一次用量按 scope 扇出多条 ledger 行，只认这一种口径避免重复计费，
// 见 cost.ts 的 aggregateByScope 既有注释）。
export async function listDailyCostByProjects(
  db: WorkHubDb,
  input: ListDailyCostByProjectsInput
): Promise<RiskMonitorDailyCostRow[]> {
  if (input.projectIds.length === 0) {
    return [];
  }
  const costSumExpr = sql<string>`coalesce(sum(${costLedgerEntries.estimatedCostCny}), 0)`;
  return db
    .select({
      projectId: workItems.projectId,
      periodBucket: costLedgerEntries.periodBucket,
      costCny: sql<string>`${costSumExpr}::text`
    })
    .from(costLedgerEntries)
    .innerJoin(workItems, eq(workItems.id, costLedgerEntries.workItemId))
    .where(
      and(
        eq(costLedgerEntries.scopeKind, "workitem"),
        inArray(workItems.projectId, input.projectIds),
        gte(costLedgerEntries.periodBucket, input.sinceBucket)
      )
    )
    .groupBy(workItems.projectId, costLedgerEntries.periodBucket);
}
