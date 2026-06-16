import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";

import { TEAM_SKILL_DISCARD_MEMORY_LIMIT, TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { acceptedDeliverableChanges, auditLogs, escalationEvents, teamSkills, workItems, workspaces } from "../schema/index.js";

export type TeamSkillRow = typeof teamSkills.$inferSelect;

export type PromoteTeamSkillInput = {
  workspaceId: string;
  skillKey: string;
  name: string;
  whenToUse: string;
  contentMd: string;
  confidenceScore?: number;
  sampleCount?: number;
  samplesJson?: Record<string, unknown>;
  sourceRunId?: string;
  sourceKind?: "distilled" | "authored";
  createdByKind?: "ai" | "human";
};

export type AcceptedDeliverableSignal = { targetKind: string; count: number };
export type EscalationSignal = { reasonMd: string; trigger: string; count: number };
// K1（借鉴 SkillOpt rejected-edit buffer）：曾被蒸馏出来但自验未过而放弃的提议，回灌给 curator 当「勿再原样重提」记忆。
export type DiscardedSkillSignal = { skillKey: string; reason: string; count: number; lastAt: string };

export type TeamSkillRepository = {
  promote: (input: PromoteTeamSkillInput) => Promise<TeamSkillRow>;
  listActive: (workspaceId: string) => Promise<TeamSkillRow[]>;
  listForWorkspace: (workspaceId: string) => Promise<TeamSkillRow[]>;
  getLatestVersion: (workspaceId: string, skillKey: string) => Promise<number>;
  listActiveSkillKeys: (workspaceId: string) => Promise<string[]>;
  deprecate: (workspaceId: string, id: string, reason: string, at?: Date) => Promise<boolean>;
  rollbackTo: (workspaceId: string, skillKey: string, version: number, at?: Date) => Promise<boolean>;
  // 蒸馏信号源（按 workspace 经 work_items 联接限定）。
  listActiveWorkspaceIds: () => Promise<string[]>;
  acceptedDeliverableSignals: (workspaceId: string, since: Date) => Promise<AcceptedDeliverableSignal[]>;
  escalationSignals: (workspaceId: string, since: Date) => Promise<EscalationSignal[]>;
  // K1：读回近期 team_skill.distilled_but_discarded 审计，按 skill_key 聚合成「勿再重提」记忆。
  discardedSkillSignals: (workspaceId: string, since: Date) => Promise<DiscardedSkillSignal[]>;
};

// 活跃技能超上限时，按 confidence 升序驱逐最弱的（deprecate）。
async function evictActiveOverCap(db: WorkHubDb, workspaceId: string, at: Date): Promise<void> {
  const active = await db
    .select({ id: teamSkills.id, confidence: teamSkills.confidenceScore })
    .from(teamSkills)
    .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.status, "active")))
    .orderBy(desc(sql`coalesce(${teamSkills.confidenceScore}, 0)`), desc(teamSkills.createdAt));
  if (active.length <= TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE) {
    return;
  }
  for (const row of active.slice(TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE)) {
    await db
      .update(teamSkills)
      .set({ status: "deprecated", deprecatedReason: "active cap exceeded", deprecatedAt: at, updatedAt: at })
      .where(eq(teamSkills.id, row.id));
  }
}

export function createTeamSkillRepository(db: WorkHubDb): TeamSkillRepository {
  async function latestVersion(workspaceId: string, skillKey: string, executor: WorkHubDb = db): Promise<number> {
    const rows = await executor
      .select({ version: teamSkills.version })
      .from(teamSkills)
      .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.skillKey, skillKey)))
      .orderBy(desc(teamSkills.version))
      .limit(1);
    return rows[0]?.version ?? 0;
  }

  return {
    async promote(input) {
      const now = new Date();
      // 三步原子化（M14）：弃旧 active → 插新 active → 超额驱逐。否则中途崩溃会让该 key 没有任何 active 版本。
      return db.transaction(async (tx) => {
        const nextVersion = (await latestVersion(input.workspaceId, input.skillKey, tx)) + 1;

        // 同 key 的旧 active 版本先弃用，保证"一 key 一 active"。
        await tx
          .update(teamSkills)
          .set({
            status: "deprecated",
            deprecatedReason: `superseded by v${nextVersion}`,
            deprecatedAt: now,
            updatedAt: now
          })
          .where(
            and(
              eq(teamSkills.workspaceId, input.workspaceId),
              eq(teamSkills.skillKey, input.skillKey),
              eq(teamSkills.status, "active")
            )
          );

        const inserted = await tx
          .insert(teamSkills)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            skillKey: input.skillKey,
            name: input.name,
            whenToUse: input.whenToUse,
            contentMd: input.contentMd,
            status: "active",
            version: nextVersion,
            sourceKind: input.sourceKind ?? "distilled",
            createdByKind: input.createdByKind ?? "ai",
            ...(input.confidenceScore !== undefined ? { confidenceScore: input.confidenceScore } : {}),
            sampleCount: input.sampleCount ?? 0,
            ...(input.samplesJson ? { samplesJson: input.samplesJson } : {}),
            ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {})
          })
          .returning();
        await evictActiveOverCap(tx, input.workspaceId, now);
        return inserted[0]!;
      });
    },

    async listActive(workspaceId) {
      return db
        .select()
        .from(teamSkills)
        .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.status, "active")))
        .orderBy(teamSkills.skillKey);
    },

    async listForWorkspace(workspaceId) {
      return db
        .select()
        .from(teamSkills)
        .where(eq(teamSkills.workspaceId, workspaceId))
        .orderBy(teamSkills.skillKey, desc(teamSkills.version));
    },

    getLatestVersion: latestVersion,

    async listActiveSkillKeys(workspaceId) {
      const rows = await db
        .select({ skillKey: teamSkills.skillKey })
        .from(teamSkills)
        .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.status, "active")));
      return rows.map((row) => row.skillKey);
    },

    async deprecate(workspaceId, id, reason, at) {
      const now = at ?? new Date();
      const updated = await db
        .update(teamSkills)
        .set({ status: "deprecated", deprecatedReason: reason, deprecatedAt: now, updatedAt: now })
        .where(and(eq(teamSkills.id, id), eq(teamSkills.workspaceId, workspaceId), ne(teamSkills.status, "deprecated")))
        .returning({ id: teamSkills.id });
      return updated.length > 0;
    },

    async rollbackTo(workspaceId, skillKey, version, at) {
      const now = at ?? new Date();
      // 目标版本设 active，同 key 其余版本弃用（人类回滚 / kill-switch 配套）。
      // 两步原子化（M14）：否则中途崩溃会出现多个 active 或一个都不 active。
      return db.transaction(async (tx) => {
        const target = await tx
          .update(teamSkills)
          .set({ status: "active", deprecatedReason: null, deprecatedAt: null, updatedAt: now })
          .where(
            and(
              eq(teamSkills.workspaceId, workspaceId),
              eq(teamSkills.skillKey, skillKey),
              eq(teamSkills.version, version)
            )
          )
          .returning({ id: teamSkills.id });
        if (target.length === 0) {
          return false;
        }
        await tx
          .update(teamSkills)
          .set({ status: "deprecated", deprecatedReason: `rolled back to v${version}`, deprecatedAt: now, updatedAt: now })
          .where(
            and(
              eq(teamSkills.workspaceId, workspaceId),
              eq(teamSkills.skillKey, skillKey),
              ne(teamSkills.version, version)
            )
          );
        return true;
      });
    },

    async listActiveWorkspaceIds() {
      const rows = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(isNull(workspaces.deletedAt));
      return rows.map((row) => row.id);
    },

    async acceptedDeliverableSignals(workspaceId, since) {
      const rows = await db
        .select({
          targetKind: acceptedDeliverableChanges.targetKind,
          count: sql<number>`count(*)::int`
        })
        .from(acceptedDeliverableChanges)
        .innerJoin(workItems, eq(acceptedDeliverableChanges.workItemId, workItems.id))
        .where(
          and(
            eq(workItems.workspaceId, workspaceId),
            gte(acceptedDeliverableChanges.createdAt, since),
            isNull(acceptedDeliverableChanges.supersededAt)
          )
        )
        .groupBy(acceptedDeliverableChanges.targetKind)
        .orderBy(desc(sql`count(*)`));
      return rows.map((row) => ({ targetKind: row.targetKind, count: Number(row.count) }));
    },

    async escalationSignals(workspaceId, since) {
      const rows = await db
        .select({
          reasonMd: escalationEvents.reasonMd,
          trigger: escalationEvents.trigger,
          count: sql<number>`count(*)::int`
        })
        .from(escalationEvents)
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .where(and(eq(workItems.workspaceId, workspaceId), gte(escalationEvents.createdAt, since)))
        .groupBy(escalationEvents.reasonMd, escalationEvents.trigger)
        .orderBy(desc(sql`count(*)`))
        .limit(20);
      return rows.map((row) => ({ reasonMd: row.reasonMd, trigger: row.trigger, count: Number(row.count) }));
    },

    async discardedSkillSignals(workspaceId, since) {
      // entity_id = skill_key（worker 放弃时这样写）；detail_json.reason 是放弃理由。
      // 在 JS 里按 skill_key 聚合（jsonb 分组在 SQL 里笨重），保留出现次数 + 最近一次理由/时间。
      const rows = await db
        .select({
          skillKey: auditLogs.entityId,
          detailJson: auditLogs.detailJson,
          createdAt: auditLogs.createdAt
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, "team_skill.distilled_but_discarded"),
            gte(auditLogs.createdAt, since)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(200);

      const byKey = new Map<string, DiscardedSkillSignal>();
      for (const row of rows) {
        const existing = byKey.get(row.skillKey);
        if (existing) {
          existing.count += 1;
          continue;
        }
        const reasonValue = (row.detailJson as { reason?: unknown } | null)?.reason;
        byKey.set(row.skillKey, {
          skillKey: row.skillKey,
          // rows 已按时间倒序，首次见到即最近一次的理由/时间。
          reason: typeof reasonValue === "string" ? reasonValue : "unknown",
          count: 1,
          lastAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString()
        });
      }
      return [...byKey.values()]
        .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
        .slice(0, TEAM_SKILL_DISCARD_MEMORY_LIMIT);
    }
  };
}
