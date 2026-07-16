import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";

import type { WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  projects,
  proactiveIntents,
  workItemAssignments,
  workItems
} from "../schema/index.js";

// R15 批 D（主动性 MVP · ProactiveIntent 管线，见 0063 迁移注释）：审计地基的四条读写原语 +
// 追 DDL 阶梯的候选扫描。服务层（apps/api/src/services/proactive-intents.ts / ddl-chase.ts）据此
// 「先记 intent 再投递」，纯规则、无 LLM。抑制/频控/阶梯判定全部留在应用层，这层只把数据老实搬出/落。

export type RecordProactiveIntentInput = {
  workspaceId: string;
  projectId: string | null;
  workItemId: string | null;
  kind: string;
  stage: string | null;
  targetUserId: string | null;
  suppressionKey: string;
  payload: Record<string, unknown>;
  at: Date;
  // 测试可注入确定性 id；生产默认 randomUUID（id 列无 DB 默认值，见 0063）。
  id?: string;
};

export type RecordProactiveIntentResult = {
  // false = suppression_key 撞唯一约束（这件事此前已记过）→ 幂等跳过，不重投。
  created: boolean;
  // 撞约束时无新行，id 为 undefined（调用方 created=false 分支不需要它）。
  id?: string;
};

// 「先记 intent」：INSERT ... ON CONFLICT (suppression_key) DO NOTHING RETURNING id。
// 撞唯一约束返回空数组 → created=false（已处理过）。这是全链幂等的单一真相源。
export async function recordProactiveIntent(
  db: WorkHubDb,
  input: RecordProactiveIntentInput
): Promise<RecordProactiveIntentResult> {
  const rows = await db
    .insert(proactiveIntents)
    .values({
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: input.kind,
      stage: input.stage,
      targetUserId: input.targetUserId,
      suppressionKey: input.suppressionKey,
      payload: input.payload,
      status: "created",
      createdAt: input.at
    })
    .onConflictDoNothing({ target: proactiveIntents.suppressionKey })
    .returning({ id: proactiveIntents.id });
  const row = rows[0];
  return row ? { created: true, id: row.id } : { created: false };
}

// 每人每日频控：某 target 在 [from, to) 区间内已 delivered 的 intent 数（当日=服务器本地日，区间由
// 应用层算）。只数 delivered——created（记了没投）/suppressed（被挡下）不占配额。
export async function countDeliveredProactiveIntentsForUser(
  db: WorkHubDb,
  input: { targetUserId: string; from: Date; to: Date }
): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(proactiveIntents)
    .where(
      and(
        eq(proactiveIntents.targetUserId, input.targetUserId),
        eq(proactiveIntents.status, "delivered"),
        sql`${proactiveIntents.createdAt} >= ${input.from}`,
        sql`${proactiveIntents.createdAt} < ${input.to}`
      )
    );
  return rows[0]?.value ?? 0;
}

// R15 批 F（关怀周频总闸）：某 target 在 [from, to) 区间内已 delivered 的【关怀】intent 数（kind='care'）。
// 关怀比 DDL 提醒更需克制——除了复用每人每日上限，再叠一层「每人每周至多 N 条关怀」的更严闸，本函数是
// 那层闸的计数源。只数 delivered（created/suppressed 不占配额），口径与 countDeliveredProactiveIntentsForUser 一致。
export async function countDeliveredCareIntentsForUser(
  db: WorkHubDb,
  input: { targetUserId: string; from: Date; to: Date }
): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(proactiveIntents)
    .where(
      and(
        eq(proactiveIntents.targetUserId, input.targetUserId),
        eq(proactiveIntents.kind, "care"),
        eq(proactiveIntents.status, "delivered"),
        sql`${proactiveIntents.createdAt} >= ${input.from}`,
        sql`${proactiveIntents.createdAt} < ${input.to}`
      )
    );
  return rows[0]?.value ?? 0;
}

// 投递闸走完后把 intent 从 created 顶到终态：delivered（附 delivered_via）或 suppressed（频控/静音挡下）。
export async function markProactiveIntentStatus(
  db: WorkHubDb,
  input: { id: string; status: "delivered" | "suppressed"; deliveredVia?: string }
): Promise<void> {
  await db
    .update(proactiveIntents)
    .set({
      status: input.status,
      ...(input.deliveredVia ? { deliveredVia: input.deliveredVia } : {})
    })
    .where(eq(proactiveIntents.id, input.id));
}

// ── 追 DDL 阶梯：候选工作项扫描 ─────────────────────────────────────────────────────────

export type DdlChaseCandidateRow = {
  workItemId: string;
  code: string;
  title: string | null;
  status: WorkItemStatus;
  dueAt: Date;
  projectId: string;
  workspaceId: string;
  claimedByUserId: string | null;
  projectOwnerUserId: string | null;
  // 责任人判定（应用层用）：认领人 > lead 指派 > 协作者指派。
  leadUserId: string | null;
  collaboratorUserId: string | null;
};

// 终态：完成/取消的工作项自动退出巡检（与 schedule-notify-pages.ts 的 isDoneWorkItem 口径一致）。
const DDL_TERMINAL_STATUSES: WorkItemStatus[] = ["merged", "done", "cancelled"];

// 扫「有 due_at、未完成、有阶梯可发」的工作项：due_at <= now + horizon（72h 是最早的 T-3d 阶梯窗口
// 起点；再往后的 due 还没进任何阶梯，不产候选）。个人空间 / DM 容器 / 已归档已删除项目天然排除。
// 每 tick cap（limit）封顶，避免积压时一次拖垮。责任人/项目负责人在 work_item_assignments 里，
// 单独一批查（IN 候选 id）后按工作项归并，避免每工作项 N+1。
export async function listDdlChaseCandidates(
  db: WorkHubDb,
  input: { now: Date; horizonMs: number; limit: number }
): Promise<DdlChaseCandidateRow[]> {
  const cutoff = new Date(input.now.getTime() + input.horizonMs);
  const rows = await db
    .select({
      workItemId: workItems.id,
      code: workItems.code,
      title: workItems.title,
      status: workItems.status,
      dueAt: workItems.dueAt,
      projectId: workItems.projectId,
      workItemWorkspaceId: workItems.workspaceId,
      projectWorkspaceId: projects.workspaceId,
      claimedByUserId: workItems.claimedByUserId,
      projectOwnerUserId: projects.ownerUserId
    })
    .from(workItems)
    .innerJoin(
      projects,
      and(
        eq(projects.id, workItems.projectId),
        isNull(projects.deletedAt),
        eq(projects.archived, false),
        eq(projects.isPersonal, false),
        eq(projects.isDmContainer, false)
      )
    )
    .where(
      and(
        isNull(workItems.deletedAt),
        lte(workItems.dueAt, cutoff),
        notInArray(workItems.status, DDL_TERMINAL_STATUSES)
      )
    )
    .orderBy(asc(workItems.dueAt))
    .limit(input.limit);

  const candidates = rows.flatMap((row) => {
    // due_at IS NULL 的行被 lte(dueAt, cutoff) 天然排除（NULL 比较不为真），这里再收窄类型。
    const workspaceId = row.workItemWorkspaceId ?? row.projectWorkspaceId;
    if (!row.dueAt || !workspaceId) {
      return [];
    }
    return [{
      workItemId: row.workItemId,
      code: row.code,
      title: row.title,
      status: row.status,
      dueAt: row.dueAt,
      projectId: row.projectId,
      workspaceId,
      claimedByUserId: row.claimedByUserId,
      projectOwnerUserId: row.projectOwnerUserId,
      leadUserId: null as string | null,
      collaboratorUserId: null as string | null
    }];
  });

  if (candidates.length === 0) {
    return candidates;
  }

  const assignmentRows = await db
    .select({
      workItemId: workItemAssignments.workItemId,
      userId: workItemAssignments.userId,
      role: workItemAssignments.role
    })
    .from(workItemAssignments)
    .where(inArray(workItemAssignments.workItemId, candidates.map((candidate) => candidate.workItemId)));

  const byWorkItem = new Map<string, DdlChaseCandidateRow>(candidates.map((candidate) => [candidate.workItemId, candidate]));
  for (const assignment of assignmentRows) {
    const candidate = byWorkItem.get(assignment.workItemId);
    if (!candidate) {
      continue;
    }
    if (assignment.role === "lead") {
      candidate.leadUserId ??= assignment.userId;
    } else {
      candidate.collaboratorUserId ??= assignment.userId;
    }
  }
  return candidates;
}
