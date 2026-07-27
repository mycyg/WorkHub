import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";

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

// R21 加固（并发投递幂等）：新增 'delivering' 中间态（见 0070 迁移）——投递方必须先经
// claimProactiveIntentForDelivery 把行从 created 原子领取到 delivering，领取成功才允许执行投递副作用，
// 两个并发调用只有一个能领到，conversation_message/action_card 等无幂等通道因此不会被双投。
export type ProactiveIntentStatus = "created" | "delivering" | "delivered" | "suppressed";

export type RecordProactiveIntentInput = {
  workspaceId: string;
  projectId: string | null;
  workItemId: string | null;
  kind: string;
  stage: string | null;
  targetUserId: string | null;
  suppressionKey: string;
  payload: Record<string, unknown>;
  // R20 REL-2（#P1-11）：重投所需的投递上下文（通道/文案/降级/通知草稿）——落库以便崩溃后恢复扫描重建
  // intent。可空（历史调用不给则不落，恢复扫描据此判为不可重建）。见 services/proactive-intents.ts。
  deliveryPayload?: Record<string, unknown> | null;
  at: Date;
  // 测试可注入确定性 id；生产默认 randomUUID（id 列无 DB 默认值，见 0063）。
  id?: string;
};

export type RecordProactiveIntentResult = {
  // false = suppression_key 撞唯一约束（这件事此前已记过）。
  created: boolean;
  // 新插入时=新行 id；撞约束时=既有行 id（R20 REL-2 崩溃恢复要据既有行状态判定，故回带）。
  id?: string;
  // R20 REL-2（#P1-11）：撞约束时回带既有行状态——'created' 说明是「落 intent 后、投递前崩溃」的可恢复
  // 行（调用方据此恢复投递），'delivered'/'suppressed' 才是真 duplicate。新插入时为 undefined。
  status?: ProactiveIntentStatus;
};

// 「先记 intent」：INSERT ... ON CONFLICT (suppression_key) DO NOTHING RETURNING id。
// 新插入 → created=true。撞唯一约束（返回空数组）→ 回查既有行的 id + status：R20 REL-2 前只返回
// created=false 就丢掉了既有行信息，导致「投递前崩溃、行停在 created」的行被永久当成 duplicate 去重。
// 现在回带 { created:false, id, status } 让服务层区分「可恢复的 created」与「真 duplicate」。
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
      ...(input.deliveryPayload !== undefined && input.deliveryPayload !== null
        ? { deliveryPayload: input.deliveryPayload }
        : {}),
      status: "created",
      createdAt: input.at
    })
    .onConflictDoNothing({ target: proactiveIntents.suppressionKey })
    .returning({ id: proactiveIntents.id });
  const inserted = rows[0];
  if (inserted) {
    return { created: true, id: inserted.id };
  }
  // 撞唯一约束——回查既有行（不改动它，避免覆盖既有终态/投递上下文）。
  const existingRows = await db
    .select({ id: proactiveIntents.id, status: proactiveIntents.status })
    .from(proactiveIntents)
    .where(eq(proactiveIntents.suppressionKey, input.suppressionKey))
    .limit(1);
  const existing = existingRows[0];
  return existing
    ? { created: false, id: existing.id, status: normalizeStatus(existing.status) }
    : { created: false };
}

// status 列有 check 约束限定 created/delivering/delivered/suppressed——收窄类型（越界值兜底按 created，
// 宁可多恢复一次也不误判成终态而丢投）。
function normalizeStatus(raw: string): ProactiveIntentStatus {
  return raw === "delivering" || raw === "delivered" || raw === "suppressed" ? raw : "created";
}

// R21 加固（并发投递幂等）：投递前的原子领取——UPDATE ... WHERE status 前置条件 + RETURNING，恰好一个
// 并发调用能拿到 1 行，其余 0 行（调用方按 duplicate 收口，不执行任何投递副作用）。
//   * 常规/同 key 重试路径：只允许从 'created' 领取（stalledBefore 缺省）——已在投递中（delivering）或
//     已终态的行都领不到。
//   * 恢复扫描路径：传 stalledBefore（= now - 停滞阈值），额外允许领取「停滞的 delivering」行（created_at
//     早于该阈值）——投递中途进程崩溃的行停在 delivering，靠这里被扫回重投。
export async function claimProactiveIntentForDelivery(
  db: WorkHubDb,
  input: { id: string; stalledBefore?: Date }
): Promise<boolean> {
  const rows = await db
    .update(proactiveIntents)
    .set({ status: "delivering" })
    .where(
      and(
        eq(proactiveIntents.id, input.id),
        input.stalledBefore
          ? and(
              inArray(proactiveIntents.status, ["created", "delivering"]),
              lt(proactiveIntents.createdAt, input.stalledBefore)
            )
          : eq(proactiveIntents.status, "created")
      )
    )
    .returning({ id: proactiveIntents.id });
  return rows.length === 1;
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

// R17 G3（#8 军团后台任务区接真 · 主动性动态）：某工作区内、投给某个用户的最近【已落终态】主动性动态
// （delivered / suppressed，不含 created 这个瞬态中间态）——军团面板「后台任务」区据此展示 Cuu 的主动性
// 机器最近为「你」做了什么（追 DDL / 关怀 / 找人），delivered/suppressed 都展示（被频控/静音挡下的也是
// 一种诚实的「机器动过、但克制住了」）。可见口径：workspace + target_user 双重收窄——每个成员只看到投向
// 自己的动态，无需 admin 概念；target_user 为空的 intent（不针对具体人）天然不在此口径内。只读，无副作用。
export type RecentProactiveIntentRow = {
  id: string;
  kind: string;
  stage: string | null;
  status: "delivered" | "suppressed";
  deliveredVia: string | null;
  projectId: string | null;
  workItemId: string | null;
  createdAt: Date;
};

export async function listRecentProactiveIntentsForUser(
  db: WorkHubDb,
  input: { workspaceId: string; targetUserId: string; limit: number }
): Promise<RecentProactiveIntentRow[]> {
  const rows = await db
    .select({
      id: proactiveIntents.id,
      kind: proactiveIntents.kind,
      stage: proactiveIntents.stage,
      status: proactiveIntents.status,
      deliveredVia: proactiveIntents.deliveredVia,
      projectId: proactiveIntents.projectId,
      workItemId: proactiveIntents.workItemId,
      createdAt: proactiveIntents.createdAt
    })
    .from(proactiveIntents)
    .where(
      and(
        eq(proactiveIntents.workspaceId, input.workspaceId),
        eq(proactiveIntents.targetUserId, input.targetUserId),
        inArray(proactiveIntents.status, ["delivered", "suppressed"])
      )
    )
    .orderBy(desc(proactiveIntents.createdAt), desc(proactiveIntents.id))
    .limit(input.limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    stage: row.stage,
    // status 列有 check 约束限定 created/delivered/suppressed，WHERE 又只取后两者——收窄类型。
    status: row.status === "suppressed" ? "suppressed" : "delivered",
    deliveredVia: row.deliveredVia,
    projectId: row.projectId,
    workItemId: row.workItemId,
    createdAt: row.createdAt
  }));
}

// 投递闸走完后把 intent 从 delivering 顶到终态：delivered（附 delivered_via）或 suppressed（频控/静音挡下）。
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

// ── R20 REL-2（#P1-11）：崩溃恢复兜底扫描 ──────────────────────────────────────────────────
//
// 「落 intent 后、投递前进程崩溃」的行永远停在 created。同 key 重试能救回大部分（见服务层），但没有重试的
// 那些要靠 pulse 任务 proactive-intent-recovery 定期扫回来重投。

export type RecoverableProactiveIntentRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  workItemId: string | null;
  kind: string;
  stage: string | null;
  targetUserId: string | null;
  suppressionKey: string;
  payload: Record<string, unknown>;
  // record 时落库的投递上下文；历史行为 null → 服务层重建不出、直接判 stalled。
  deliveryPayload: Record<string, unknown> | null;
  attemptCount: number;
  createdAt: Date;
};

// 扫「停在 created 或 delivering、够旧（created_at 早于 olderThanMs，给直投路径留出完成窗口，避免抢在
// 途中的行）、重投次数未达上限（attempt_count < maxAttempts）」的行，最旧优先，limit 封顶。返回重投
// 所需全字段。R21 加固：delivering 也可恢复——投递中途进程崩溃的行停在 delivering，不扫它就永久滞留；
// 真正在途的行由停滞阈值 + claimProactiveIntentForDelivery 的原子领取共同保护，不会被抢投。
export async function listRecoverableProactiveIntents(
  db: WorkHubDb,
  input: { now: Date; olderThanMs: number; maxAttempts: number; limit: number }
): Promise<RecoverableProactiveIntentRow[]> {
  const cutoff = new Date(input.now.getTime() - input.olderThanMs);
  const rows = await db
    .select({
      id: proactiveIntents.id,
      workspaceId: proactiveIntents.workspaceId,
      projectId: proactiveIntents.projectId,
      workItemId: proactiveIntents.workItemId,
      kind: proactiveIntents.kind,
      stage: proactiveIntents.stage,
      targetUserId: proactiveIntents.targetUserId,
      suppressionKey: proactiveIntents.suppressionKey,
      payload: proactiveIntents.payload,
      deliveryPayload: proactiveIntents.deliveryPayload,
      attemptCount: proactiveIntents.attemptCount,
      createdAt: proactiveIntents.createdAt
    })
    .from(proactiveIntents)
    .where(
      and(
        inArray(proactiveIntents.status, ["created", "delivering"]),
        lt(proactiveIntents.createdAt, cutoff),
        lt(proactiveIntents.attemptCount, input.maxAttempts)
      )
    )
    .orderBy(asc(proactiveIntents.createdAt))
    .limit(input.limit);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workItemId: row.workItemId,
    kind: row.kind,
    stage: row.stage,
    targetUserId: row.targetUserId,
    suppressionKey: row.suppressionKey,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    deliveryPayload: (row.deliveryPayload ?? null) as Record<string, unknown> | null,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt
  }));
}

// 恢复扫描每重投一次就把该行 attempt_count 原子自增 1（在 SQL 里 attempt_count + 1，不依赖读到的旧值）。
export async function incrementProactiveIntentAttempt(
  db: WorkHubDb,
  input: { id: string }
): Promise<void> {
  await db
    .update(proactiveIntents)
    .set({ attemptCount: sql`${proactiveIntents.attemptCount} + 1` })
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
