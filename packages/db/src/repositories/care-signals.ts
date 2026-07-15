import { randomUUID } from "node:crypto";

import { and, eq, gt, gte, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  projects,
  proposals,
  reviews,
  userMemories,
  workItemAssignments,
  workItems
} from "../schema/index.js";

// R15 批 F（主动关怀 · 规则信号写入源，见 proactive-intents.ts / ddl-chase.ts 的闸门约定）：
// care 信号是「纯规则侦测出的、关于成员当前状态的可衰减记忆」，不是自由文本偏好记忆——单列一个
// category='care_signal'，与 preference/correction/recurring_context 完全隔离：
//   * 绝不注入 agent worker prompt（listForUser 在 SQL 层排除本分类）；
//   * 绝不出现在记忆管理页（同一条 listForUser 排除，管理页也走 listForUser）；
//   * 过期即失效（listActiveCareSignals 只认 expires_at > now），物理清理复用既有全局 prune。
// 存进 user_memories 是刻意的「记忆写入源拓宽」：此前唯一写入源=审批打回(correction)，本批新增关怀扫描。
// 三类信号（键=signalType）：high_load（高负荷）/ late_night（深夜活跃）/ frustration（连续受挫）。
// 侦测（detect*）纯规则、零 LLM；写入（upsertCareSignal）幂等 upsert；读取（listActiveCareSignals）给
// 关怀扫描服务（apps/api/src/services/care-scan.ts）产 care intent。

export const CARE_SIGNAL_CATEGORY = "care_signal" as const;

export type CareSignalType = "high_load" | "late_night" | "frustration";

export const CARE_SIGNAL_TYPES: readonly CareSignalType[] = ["high_load", "late_night", "frustration"];

// 关怀信号默认存活 14 天（过期衰减）。到期后 listActiveCareSignals 直接不再认它（失效），物理软删由既有
// 全局 prune 兜底——这里只管「活着的信号 = expires_at 还没到」。
export const DEFAULT_CARE_SIGNAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// 终态工作项排除（与 proactive-intents.ts / schedule-notify-pages.ts 的 isDoneWorkItem 口径一致）。
const CARE_TERMINAL_STATUSES = ["merged", "done", "cancelled"] as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isCareSignalType(value: string): value is CareSignalType {
  return (CARE_SIGNAL_TYPES as readonly string[]).includes(value);
}

export type UpsertCareSignalInput = {
  userId: string;
  workspaceId: string;
  signalType: CareSignalType;
  // 内部审计素材（如「负责的未完成工作项 12 件，其中 3 件已逾期」）——绝不作为发给用户的关怀文案，
  // 关怀文案是纯模板（careConversationText），不引用任何具体信号细节，避免让人觉得被监视。
  valueMd: string;
  confidence: number;
  now: Date;
  ttlMs?: number;
};

// 幂等 upsert：按 (user, workspace, category=care_signal, key=signalType) 命中既有活跃行则更新
// （正文/confidence/过期时间/updated_at 顺延，等于「续命 + 刷新强度」），否则插入一条新信号。
// 关怀扫描是单实例 pulse（进程内互斥），无并发同 key 写；插入撞局部唯一索引（0035 的 workspace_key_uq）
// 由 onConflictDoNothing 兜底，绝不 500。
export async function upsertCareSignal(db: WorkHubDb, input: UpsertCareSignalInput): Promise<void> {
  const ttlMs = input.ttlMs ?? DEFAULT_CARE_SIGNAL_TTL_MS;
  const expiresAt = new Date(input.now.getTime() + ttlMs);
  const existing = await db
    .select({ id: userMemories.id })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, input.userId),
        eq(userMemories.workspaceId, input.workspaceId),
        eq(userMemories.category, CARE_SIGNAL_CATEGORY),
        eq(userMemories.key, input.signalType),
        isNull(userMemories.deletedAt)
      )
    )
    .limit(1);
  const found = existing[0];
  if (found) {
    await db
      .update(userMemories)
      .set({
        valueMd: input.valueMd,
        confidence: input.confidence,
        expiresAt,
        updatedAt: input.now
      })
      .where(eq(userMemories.id, found.id));
    return;
  }
  await db
    .insert(userMemories)
    .values({
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      category: CARE_SIGNAL_CATEGORY,
      key: input.signalType,
      valueMd: input.valueMd,
      confidence: input.confidence,
      expiresAt,
      createdAt: input.now,
      updatedAt: input.now
    })
    .onConflictDoNothing();
}

export type ActiveCareSignal = {
  userId: string;
  workspaceId: string;
  signalType: CareSignalType;
  confidence: number;
  updatedAt: Date;
};

// 关怀扫描读端：取全部「活着的」关怀信号（未软删、未过期），供扫描产 care intent。工作区维度天然带出
// （关怀信号恒挂 workspace，投递要按 workspace 定位个人空间主区）。limit 封顶，避免一 tick 拖垮。
export async function listActiveCareSignals(
  db: WorkHubDb,
  input: { now: Date; limit: number }
): Promise<ActiveCareSignal[]> {
  const rows = await db
    .select({
      userId: userMemories.userId,
      workspaceId: userMemories.workspaceId,
      key: userMemories.key,
      confidence: userMemories.confidence,
      updatedAt: userMemories.updatedAt
    })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.category, CARE_SIGNAL_CATEGORY),
        isNull(userMemories.deletedAt),
        isNotNull(userMemories.workspaceId),
        gt(userMemories.expiresAt, input.now)
      )
    )
    .limit(input.limit);
  return rows.flatMap((row) => {
    if (!row.workspaceId || !isCareSignalType(row.key)) {
      return [];
    }
    return [{
      userId: row.userId,
      workspaceId: row.workspaceId,
      signalType: row.key,
      confidence: row.confidence,
      updatedAt: row.updatedAt
    }];
  });
}

export type HighLoadSignalRow = {
  workspaceId: string;
  userId: string;
  openCount: number;
  overdueCount: number;
};

// ── a. 高负荷 ────────────────────────────────────────────────────────────────────────────
// 责任人为该用户的未完成工作项数 ≥ threshold 且其中含逾期。责任人判定复用 ddl-chase 的
// 「认领人 > lead 指派 > 协作者指派」优先级（与追 DDL 同一口径，不另立标准）。逾期=有 due_at 且已过。
// 用有界拉取 + JS 归并（与 listDdlChaseCandidates 同结构）：一次拉未完成工作项 + 一次拉其指派，避免
// 每工作项 N+1；limit 封顶保护扫描（团队量级下未完成工作项有限）。
export async function detectHighLoadSignals(
  db: WorkHubDb,
  input: { now: Date; threshold: number; limit: number }
): Promise<HighLoadSignalRow[]> {
  const rows = await db
    .select({
      workItemId: workItems.id,
      dueAt: workItems.dueAt,
      workItemWorkspaceId: workItems.workspaceId,
      projectWorkspaceId: projects.workspaceId,
      claimedByUserId: workItems.claimedByUserId
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
        notInArray(workItems.status, [...CARE_TERMINAL_STATUSES])
      )
    )
    .limit(input.limit);

  type Candidate = {
    workItemId: string;
    workspaceId: string;
    overdue: boolean;
    claimedByUserId: string | null;
    leadUserId: string | null;
    collaboratorUserId: string | null;
  };
  const candidates: Candidate[] = rows.flatMap((row) => {
    const workspaceId = row.workItemWorkspaceId ?? row.projectWorkspaceId;
    if (!workspaceId) {
      return [];
    }
    return [{
      workItemId: row.workItemId,
      workspaceId,
      overdue: Boolean(row.dueAt && row.dueAt.getTime() < input.now.getTime()),
      claimedByUserId: row.claimedByUserId,
      leadUserId: null,
      collaboratorUserId: null
    }];
  });
  if (candidates.length === 0) {
    return [];
  }

  const assignmentRows = await db
    .select({
      workItemId: workItemAssignments.workItemId,
      userId: workItemAssignments.userId,
      role: workItemAssignments.role
    })
    .from(workItemAssignments)
    .where(inArray(workItemAssignments.workItemId, candidates.map((candidate) => candidate.workItemId)));
  const byWorkItem = new Map<string, Candidate>(candidates.map((candidate) => [candidate.workItemId, candidate]));
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

  const tally = new Map<string, HighLoadSignalRow>();
  for (const candidate of candidates) {
    const responsible = candidate.claimedByUserId ?? candidate.leadUserId ?? candidate.collaboratorUserId;
    if (!responsible) {
      continue;
    }
    const bucketKey = `${candidate.workspaceId}:${responsible}`;
    const bucket = tally.get(bucketKey) ?? {
      workspaceId: candidate.workspaceId,
      userId: responsible,
      openCount: 0,
      overdueCount: 0
    };
    bucket.openCount += 1;
    if (candidate.overdue) {
      bucket.overdueCount += 1;
    }
    tally.set(bucketKey, bucket);
  }
  return [...tally.values()].filter(
    (bucket) => bucket.openCount >= input.threshold && bucket.overdueCount >= 1
  );
}

export type LateNightSignalRow = {
  workspaceId: string;
  userId: string;
  nightCount: number;
};

// ── b. 深夜活跃 ──────────────────────────────────────────────────────────────────────────
// 近 windowDays 天内 ≥ minNights 个不同「日历日」在深夜时段（23:00–06:00，服务器本地时区）有活动。
// 源=agent_runs（用户发起的 worker run，actor_user_id + workspace_id + created_at 均有索引，是唯一
// 直接可按 workspace 归属的便宜活动源；conversation_messages 无 workspace_id 列，需三表 join，故不选，
// 见交付报告取舍）。深夜判定用 Date.getHours()（进程本地时区），与 isWithinProactiveQuietHours 同口径。
export async function detectLateNightSignals(
  db: WorkHubDb,
  input: { now: Date; windowDays: number; minNights: number; limit: number }
): Promise<LateNightSignalRow[]> {
  const from = new Date(input.now.getTime() - input.windowDays * DAY_MS);
  const rows = await db
    .select({
      workspaceId: agentRuns.workspaceId,
      actorUserId: agentRuns.actorUserId,
      createdAt: agentRuns.createdAt
    })
    .from(agentRuns)
    .where(
      and(
        gte(agentRuns.createdAt, from),
        isNotNull(agentRuns.actorUserId),
        isNotNull(agentRuns.workspaceId)
      )
    )
    .limit(input.limit);

  // (workspace, user) → 深夜活动过的不同日历日集合。
  const nights = new Map<string, { workspaceId: string; userId: string; days: Set<string> }>();
  for (const row of rows) {
    if (!row.workspaceId || !row.actorUserId) {
      continue;
    }
    const at = row.createdAt;
    const hour = at.getHours();
    const isLateNight = hour >= 23 || hour < 6;
    if (!isLateNight) {
      continue;
    }
    const dayKey = `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
    const bucketKey = `${row.workspaceId}:${row.actorUserId}`;
    const bucket = nights.get(bucketKey) ?? { workspaceId: row.workspaceId, userId: row.actorUserId, days: new Set<string>() };
    bucket.days.add(dayKey);
    nights.set(bucketKey, bucket);
  }
  return [...nights.values()]
    .filter((bucket) => bucket.days.size >= input.minNights)
    .map((bucket) => ({ workspaceId: bucket.workspaceId, userId: bucket.userId, nightCount: bucket.days.size }));
}

export type FrustrationSignalRow = {
  workspaceId: string;
  userId: string;
  rejectionCount: number;
};

// ── c. 连续受挫 ──────────────────────────────────────────────────────────────────────────
// 近 windowDays 天内该用户的提案被打回 ≥ threshold 次。「被打回」=reviews.decision='reject'
// （注意：service 层入参叫 request_changes，但落 reviews 表统一存 'reject'，见 proposals 仓库）。
// 受挫主体=提案发起人（proposals.opened_by_user_id）——被反复退回工作的那个人，不是评审者。
// workspace 经 work_items 取（work_item.workspace_id 兜底 project.workspace_id）。纯 SQL 聚合（group+having）。
export async function detectFrustrationSignals(
  db: WorkHubDb,
  input: { now: Date; windowDays: number; threshold: number }
): Promise<FrustrationSignalRow[]> {
  const from = new Date(input.now.getTime() - input.windowDays * DAY_MS);
  const workspaceExpr = sql<string>`coalesce(${workItems.workspaceId}, ${projects.workspaceId})`;
  const rows = await db
    .select({
      workspaceId: workspaceExpr,
      userId: proposals.openedByUserId,
      rejectionCount: sql<number>`count(*)::int`
    })
    .from(reviews)
    .innerJoin(proposals, eq(reviews.proposalId, proposals.id))
    .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
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
        eq(reviews.decision, "reject"),
        gte(reviews.createdAt, from),
        isNotNull(proposals.openedByUserId)
      )
    )
    .groupBy(workspaceExpr, proposals.openedByUserId)
    .having(sql`count(*) >= ${input.threshold}`);
  return rows.flatMap((row) => {
    if (!row.workspaceId || !row.userId) {
      return [];
    }
    return [{ workspaceId: row.workspaceId, userId: row.userId, rejectionCount: row.rejectionCount }];
  });
}
